import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { briefingPath, mediaType, scanText, MAX_FILE } from "../src/briefing.mjs";
import { createDocker, demux, runContainerSpec, WORKER_IMAGE } from "../src/docker.mjs";
import { createForgejo } from "../src/forgejo.mjs";
import { createSettings, defaults, merge, ROLES } from "../src/settings.mjs";
import { createLocks } from "../src/store.mjs";
import { summarize } from "../src/usage.mjs";
import { setup } from "./helpers.mjs";

test("briefing paths: plain names only", () => {
  assert.equal(briefingPath("notes.md"), "briefing/notes.md");
  assert.equal(briefingPath("briefing/Ideen/Skizze 1.png"), "briefing/Ideen/Skizze 1.png");
  for (const bad of ["", "../x", "a/../b", ".env", "a/.git/config", "/etc/passwd", "a//b", "x\u0000y", "a/b/c/d/e/f.md", "notes.", 5]) assert.equal(briefingPath(bad), null, String(bad));
});

test("media types decide readability", () => {
  assert.equal(mediaType("a.MD").kind, "text");
  assert.equal(mediaType("a.jpeg").type, "image/jpeg");
  assert.equal(mediaType("a.pdf").kind, "other");
  assert.equal(mediaType("noext").type, "application/octet-stream");
});

test("briefing upload: limits, content check, unchanged re-upload, removal", async () => {
  const t = await setup();
  await assert.rejects(t.briefing.put("demo", "../x.md", Buffer.from("x")), { status: 400 });
  await assert.rejects(t.briefing.put("demo", "e.md", Buffer.alloc(0)), { status: 400 });
  await assert.rejects(t.briefing.put("demo", "big.md", Buffer.alloc(MAX_FILE + 1, 65)), { status: 413 });
  const fake = await t.briefing.put("demo", "photo.png", Buffer.from("not a png"));
  assert.equal(fake.entry.readable, false);
  assert.match(fake.entry.unreadable_reason, /does not match/);
  const bin = await t.briefing.put("demo", "x.txt", Buffer.from([0xff, 0xfe, 0x00]));
  assert.equal(bin.entry.readable, false);
  const bigImg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
  assert.match((await t.briefing.put("demo", "big.jpg", bigImg)).entry.unreadable_reason, /larger than 5 MB/);
  const v = t.briefing.inventory("demo").version;
  const again = await t.briefing.put("demo", "notes.md", Buffer.from("We want a booking app for our tennis club."));
  assert.equal(again.changed, false);
  assert.equal(t.briefing.inventory("demo").version, v);
  assert.equal(t.briefing.remove("demo", "x.txt").version, v + 1);
  assert.throws(() => t.briefing.remove("demo", "x.txt"), { status: 404 });
});

test("gitleaks wrapper: counts findings, fails closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-"));
  const fake = join(dir, "gitleaks");
  writeFileSync(fake, "#!/bin/sh\ncase \"$(cat \"$2\")\" in *KEY*) echo '[{\"RuleID\":\"x\"},{\"RuleID\":\"y\"}]';; *) echo '[]';; esac\n");
  chmodSync(fake, 0o755);
  assert.equal(await scanText(Buffer.from("a KEY"), fake), 2);
  assert.equal(await scanText(Buffer.from("fine"), fake), 0);
  await assert.rejects(scanText(Buffer.from("x"), join(dir, "missing")), /secret scan failed/);
});

test("settings: defaults for all nine roles, validation, persistence", () => {
  const d = defaults();
  assert.deepEqual(Object.keys(d.roles), ROLES);
  assert.ok(Object.values(d.roles).every((r) => r.model === "claude-opus-5-5" && r.effort === "medium"));
  assert.equal(d.billing_mode, "api");
  assert.equal(d.ask_human_wait_minutes, 10);
  assert.equal(merge(d, { roles: { reviewer: { effort: "high" } } }).roles.reviewer.effort, "high");
  for (const bad of [{ roles: { boss: {} } }, { roles: { reviewer: { model: "gpt-5" } } }, { roles: { reviewer: { effort: "huge" } } }, { roles: { reviewer: { temp: 1 } } },
    { billing_mode: "subscription" }, { ask_human_wait_minutes: 0 }, { max_turns_per_run: 1.5 }, { human_language: "Deutsch" }, { colour: "red" }, []]) {
    assert.throws(() => merge(d, bad), Error, JSON.stringify(bad));
  }
  const file = join(mkdtempSync(join(tmpdir(), "set-")), "settings.json");
  const s = createSettings(file);
  s.update({ ask_human_wait_minutes: 3, human_language: "en" });
  assert.equal(createSettings(file).get().ask_human_wait_minutes, 3);
  assert.equal(createSettings(file).get().roles.interviewer.web_search, false, "an older settings file gets the default: off");
});

test("settings: web search is off by default and only the interviewer may have it (scope review finding 2)", () => {
  const d = defaults();
  assert.ok(Object.values(d.roles).every((r) => r.web_search === false));
  assert.equal(merge(d, { roles: { interviewer: { web_search: true } } }).roles.interviewer.web_search, true);
  assert.equal(merge(d, { roles: { reviewer: { web_search: false } } }).roles.reviewer.web_search, false);
  assert.throws(() => merge(d, { roles: { builder: { web_search: true } } }), /only available for: interviewer/);
  assert.throws(() => merge(d, { roles: { interviewer: { web_search: "on" } } }), /true or false/);
});

test("usage: cache tokens priced, incomplete calls make the cost a lower bound, errors bill nothing", () => {
  const prices = { version: "t", models: { m: { input: 4, output: 20, cache_write: 5, cache_read: 0.2 } } };
  const u = summarize([
    { status: 200, model: "m", complete: true, input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 },
    { status: 429, complete: true },
  ], prices);
  assert.equal(u.estimated_cost_usd, 6.2);
  assert.equal(u.calls, 1);
  assert.equal(u.errors, 1);
  assert.equal(u.cost_is_lower_bound, false);
  const partial = summarize([{ status: 200, model: "m", complete: false, input_tokens: 10 }, { status: 200, model: "unknown-model", complete: true, input_tokens: 5 }], prices);
  assert.equal(partial.tokens_complete, false);
  assert.equal(partial.cost_is_lower_bound, true);
  assert.equal(summarize([], prices).estimated_cost_usd, 0);
  // web searches: 10 USD per 1,000 on top of the tokens; without a search price the cost is a lower bound
  const ws = summarize([{ status: 200, model: "m", complete: true, input_tokens: 0, output_tokens: 0, web_search_requests: 3 }], { ...prices, web_search: { usd_per_1000: 10 } });
  assert.equal(ws.web_search_requests, 3);
  assert.equal(ws.estimated_cost_usd, 0.03);
  assert.equal(ws.cost_is_lower_bound, false);
  assert.equal(summarize([{ status: 200, model: "m", complete: true, input_tokens: 0, output_tokens: 0, web_search_requests: 1 }], prices).cost_is_lower_bound, true);
});

test("run container template: fixed image, hardening, one network, two run mounts", () => {
  const s = runContainerSpec({ runId: "run-abc123", project: "levuvo-sf", env: ["A=1"] });
  assert.equal(s.Image, WORKER_IMAGE);
  assert.equal(s.User, "1001:1001", "not the factory's user (branch review finding 5)");
  const h = s.HostConfig;
  assert.equal(h.NetworkMode, "levuvo-sf_agents-api");
  assert.deepEqual([h.ReadonlyRootfs, h.CapDrop, h.SecurityOpt, h.Privileged], [true, ["ALL"], ["no-new-privileges:true"], false]);
  assert.ok(h.Memory > 0 && h.NanoCpus > 0 && h.PidsLimit > 0);
  assert.equal(h.Binds, undefined);
  assert.deepEqual(h.Mounts.map((m) => [m.Source, m.Target, m.ReadOnly, m.VolumeOptions.Subpath]), [
    ["levuvo-sf_runs", "/run/levuvo/in", true, "run-abc123/in"], ["levuvo-sf_runs", "/run/levuvo/io", false, "run-abc123/io"]]);
  assert.ok(!JSON.stringify(s).includes("docker.sock"));
  assert.throws(() => runContainerSpec({ runId: "../x", project: "levuvo-sf", env: [] }), /run id/);
  assert.throws(() => runContainerSpec({ runId: "run-abc123", project: "x y", env: [] }), /compose project/);
});

test("docker log demultiplexing", () => {
  const frame = (t, s) => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = t; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
  const buf = Buffer.concat([frame(1, "out1\n"), frame(2, "err\n"), frame(1, "out2\n")]);
  assert.deepEqual(demux(buf), { stdout: "out1\nout2\n", stderr: "err\n" });
});

test("locks run work per key one after another, also after a failure", async () => {
  const lock = createLocks();
  const order = [];
  const a = lock("k", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); throw new Error("x"); });
  const b = lock("k", async () => { order.push("b"); return 2; });
  await assert.rejects(a);
  assert.equal(await b, 2);
  assert.deepEqual(order, ["a", "b"]);
});

test("forgejo: private repo, protected main; removed again when protection fails; name clash is 409", async () => {
  const seen = [];
  let failProtection = false;
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c)).on("end", () => {
      seen.push([req.method, req.url, b ? JSON.parse(b) : null, req.headers.authorization]);
      if (req.url.endsWith("/repos") && JSON.parse(b).name === "taken") { res.writeHead(409); return res.end('{"message":"exists"}'); }
      if (req.url.endsWith("/branch_protections") && failProtection) { res.writeHead(500); return res.end("{}"); }
      res.writeHead(201, { "content-type": "application/json" }); res.end("{}");
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const tokenFile = join(mkdtempSync(join(tmpdir(), "tok-")), "token");
  writeFileSync(tokenFile, "abc123\n");
  const f = createForgejo({ base: `http://127.0.0.1:${srv.address().port}/api/v1`, tokenFile });
  const repo = await f.createProjectRepo("tennis", "Tennis club");
  assert.equal(repo.name, "tennis");
  assert.deepEqual(seen[0].slice(0, 2), ["POST", "/api/v1/orgs/levuvo-sf/repos"]);
  assert.equal(seen[0][2].private, true);
  assert.equal(seen[0][3], "token abc123");
  assert.deepEqual(seen[1][2].push_whitelist_usernames, ["levuvo-factory"]);
  await assert.rejects(f.createProjectRepo("taken", "x"), { status: 409 });
  failProtection = true;
  await assert.rejects(f.createProjectRepo("open", "x"));
  assert.deepEqual(seen.at(-1).slice(0, 2), ["DELETE", "/api/v1/repos/levuvo-sf/open"]);
  await assert.rejects(createForgejo({ tokenFile: join(tmpdir(), "nope-token") }).createProjectRepo("x", "y"), { status: 503 });
  srv.close();
});

test("docker wait survives a connection cut AFTER the response headers, and a silent one (regression: a 15-minute interview hung after its run had ended)", async () => {
  let waits = 0;
  let running = true;
  const srv = createServer((req, res) => {
    if (req.url === "/containers/c1/wait") {
      waits++;
      res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders(); // Docker answers the headers at once
      if (waits === 1) return setTimeout(() => req.socket.destroy(), 50); // the proxy's idle timeout cuts the body
      if (waits === 2) { running = false; return; } // a silent connection: only the slice timeout ends it
      return res.end(JSON.stringify({ StatusCode: 0 }));
    }
    if (req.url === "/containers/c1/json") return res.end(JSON.stringify({ State: { Running: running, ExitCode: 7 } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const docker = createDocker({ host: "127.0.0.1", port: srv.address().port, waitSliceMs: 300 });
  try {
    assert.deepEqual(await docker.wait("c1"), { StatusCode: 7 }, "exit code from the container state once it has stopped");
    assert.equal(waits, 2);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("docker wait survives a dropped connection and waits again while the container runs (regression: idle socket timeout ended live runs)", async () => {
  let waits = 0;
  let running = true;
  const srv = createServer((req, res) => {
    if (req.url === "/containers/c1/wait") {
      waits++;
      if (waits === 1) return setTimeout(() => req.socket.destroy(), 50); // proxy idle timeout cuts the long wait
      setTimeout(() => { running = false; res.end(JSON.stringify({ StatusCode: 0 })); }, 50);
      return;
    }
    if (req.url === "/containers/c1/json") return res.end(JSON.stringify({ State: { Running: running, ExitCode: 0 } }));
    if (req.url === "/containers/gone/wait") return req.socket.destroy();
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const docker = createDocker({ host: "127.0.0.1", port: srv.address().port });
  try {
    assert.deepEqual(await docker.wait("c1"), { StatusCode: 0 });
    assert.equal(waits, 2);
    await assert.rejects(docker.wait("gone"));
  } finally { srv.close(); }
});
