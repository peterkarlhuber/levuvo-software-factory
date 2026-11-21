import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunner } from "../src/runner.mjs";
import { createApi, createProjects } from "../src/server.mjs";
import { createSettings } from "../src/settings.mjs";
import { createBriefing } from "../src/briefing.mjs";
import { createInterview } from "../src/interview.mjs";
import { createLocks, readJson, writeJson } from "../src/store.mjs";
import { textOf, validator } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (s) => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = 1; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };

/** A fake Docker API whose "containers" run `script(io)`, a simulated worker that writes tool requests. */
function fakeDocker(script) {
  const containers = new Map();
  let n = 0;
  return {
    containers,
    self: async () => ({ Config: { Labels: { "com.docker.compose.project": "levuvo-sf-test" } } }),
    create: async (name, spec) => { const id = `c${++n}`; containers.set(id, { name, spec, removed: false }); return { Id: id }; },
    start: async (id) => {
      const c = containers.get(id);
      const runId = c.spec.Labels["dev.levuvo-sf.run"];
      c.done = new Promise((resolve) => { c.exit = resolve; });
      c.stopped = false;
      Promise.resolve(script({ runId, c, sleep })).then((code) => c.exit(code ?? 0), () => c.exit(1));
    },
    wait: async (id) => ({ StatusCode: await containers.get(id).done }),
    stop: async (id) => { const c = containers.get(id); c.stopped = true; c.exit(143); },
    remove: async (id) => { containers.get(id).removed = true; },
    logs: async () => ({ stdout: '{"type":"system","subtype":"init","tools":["mcp__factory__ask_human"]}\n{"type":"result","subtype":"success","is_error":false}\n', stderr: "" }),
    list: async () => [...containers].filter(([, c]) => !c.removed).map(([Id, c]) => ({ Id, Labels: c.spec.Labels })),
  };
}

async function world(script, settingsPatch = {}, { scan = async () => 0, scanFiles = async () => 0, gitApi = async () => null, ui } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rw-"));
  const dirs = { data: join(root, "data"), runs: join(root, "runs"), tokens: join(root, "tokens"), usage: join(root, "usage") };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const settings = createSettings(join(dirs.data, "settings.json"));
  settings.update(settingsPatch);
  const briefing = createBriefing({ dataDir: dirs.data, validator, scan: scanFiles });
  const interview = createInterview({ dataDir: dirs.data, briefing, validator, settings: settings.get });
  const forgejo = { createProjectRepo: async (slug) => ({ org: "levuvo-sf", name: slug, id: 7 }), api: gitApi };
  const projects = createProjects({ dataDir: dirs.data, forgejo, readJson, writeJson });
  const docker = fakeDocker(script);
  const skillsDir = join(root, "skills");
  mkdirSync(join(skillsDir, "interview"), { recursive: true });
  writeFileSync(join(skillsDir, "interview", "SKILL.md"), "# Interview skill");
  const prices = { version: "t", models: { "claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2 } } };
  const logs = [];
  const runner = createRunner({ dirs, docker, interview, briefing, settings: settings.get, prices, project: projects.get, lock: (k, fn) => lock(k, fn), skillsDir, composeProject: "levuvo-sf-test", log: (o) => logs.push(o), pollMs: 20, scan });
  const lock = createLocks();
  const api = createApi({ port: 3100, projects, briefing, interview, runner, settings, lock, ui });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = request({ host: "127.0.0.1", port: api.address().port, method, path, headers: { host: "localhost:3100", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}), ...headers } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)).on("end", () => resolve({ status: res.statusCode, body: /json/.test(res.headers["content-type"]) ? JSON.parse(b) : b }));
    });
    req.on("error", reject);
    req.end(data);
  });
  return { root, dirs, settings, interview, runner, docker, api, call, logs, projects, briefing };
}

/** Simulated worker side of the tool channel. */
function tool(dirs, runId, name, args) {
  const io = join(dirs.runs, runId, "io");
  const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
  writeFileSync(join(io, "req", `.${id}.tmp`), JSON.stringify({ id, tool: name, args }));
  renameSync(join(io, "req", `.${id}.tmp`), join(io, "req", `${id}.json`));
  return (async () => {
    for (;;) {
      const f = join(io, "res", `${id}.json`);
      if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
      if (!existsSync(io)) return null; // the run ended
      await sleep(10);
    }
  })();
}

async function newProject(w) {
  assert.equal((await w.call("POST", "/api/projects", { name: "Tennis Club" })).status, 201);
  const up = await w.call("PUT", "/api/projects/tennis-club/briefing", { path: "notes.md", content_base64: Buffer.from("Court booking for 180 members").toString("base64") });
  assert.equal(up.status, 200, JSON.stringify(up.body));
}

test("API: same-origin contract, JSON only, size limits, unknown routes", async () => {
  const w = await world(async () => 0);
  assert.equal((await w.call("GET", "/api/health", undefined, { host: "evil.example:3100" })).status, 421);
  assert.equal((await w.call("GET", "/api/health")).status, 200);
  assert.equal((await w.call("POST", "/api/projects", { name: "x" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await w.call("POST", "/api/projects", "name=x", { "content-type": "text/plain" })).status, 415);
  assert.equal((await w.call("POST", "/api/projects", "{bad")).status, 400);
  assert.equal((await w.call("POST", "/api/projects", "[1]")).status, 400);
  assert.equal((await w.call("POST", "/api/projects", { name: "x".repeat(70000) })).status, 413);
  assert.equal((await w.call("GET", "/api/nothing")).status, 404);
  assert.equal((await w.call("DELETE", "/api/health")).status, 405);
  assert.equal((await w.call("GET", "/api/projects/..%2Fetc")).status, 404);
  assert.equal((await w.call("PUT", "/api/settings", { billing_mode: "subscription" })).status, 400);
  assert.equal((await w.call("PUT", "/api/settings", { ask_human_wait_minutes: 5 })).body.ask_human_wait_minutes, 5);
  assert.equal((await w.call("POST", "/api/projects", { name: "!!" })).status, 400);
  await newProject(w);
  assert.equal((await w.call("POST", "/api/projects", { name: "Tennis Club" })).status, 409);
  assert.equal((await w.call("GET", "/api/projects")).body.length, 1);
  assert.equal((await w.call("GET", "/api/projects/tennis-club/briefing")).body.files.length, 1);
  assert.equal((await w.call("GET", "/api/projects/no-such")).status, 404);
  w.api.close();
});

test("a full run: tools through the io folder, question answered via the API, finished, cleaned up", async () => {
  let seenEnv;
  const w = await world(async ({ runId, c }) => {
    seenEnv = c.spec.Env;
    const r1 = await tool(w.dirs, runId, "read_briefing", {});
    assert.match(r1.content[0].text, /notes\.md/);
    const q = await tool(w.dirs, runId, "ask_human", { finding: "The briefing names 180 members.", decision_needed: "Confirm all sections?", recommendation: { answer: "Yes", reason: "matches" }, prd_sections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const qid = JSON.parse(q.content[0].text).question_id;
    for (let s = 1; s <= 10; s++) await tool(w.dirs, runId, "update_prd_section", { section: s, status: "confirmed", content: `S${s}`, source: `answer ${qid}`, answer_ref: qid });
    await tool(w.dirs, runId, "update_features", { features: [{ name: "Book", summary: "Book a court.", priority: "must", depends_on: [], scope_ref: "Booking", source: "briefing/notes.md" }] });
    const rej = await tool(w.dirs, runId, "finish_interview", { summary: "s" });
    assert.equal(rej.isError, true);
    await tool(w.dirs, runId, "ask_human", { finding: "Done?", decision_needed: "End the interview?", recommendation: { answer: "Yes", reason: "all settled" }, closing: true });
    const ok = await tool(w.dirs, runId, "finish_interview", { summary: "Court booking." });
    assert.equal(ok.isError, undefined);
    // a malformed request and a duplicate are refused without effect
    writeFileSync(join(w.dirs.runs, runId, "io", "req", "abc-000000000000.json"), "{not json");
    await sleep(80);
    return 0;
  });
  await newProject(w);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 200);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 409, "only one run at a time");
  const answerOpen = async () => {
    for (;;) {
      const iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
      if (iv.status === "waiting_for_human") return iv.open_question;
      await sleep(10);
    }
  };
  let q = await answerOpen();
  assert.equal(q.id, "Q-001");
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "" })).status, 400);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "Ja, passt" })).body.delivered, true);
  q = await answerOpen();
  assert.equal(q.refs[0], "interview end");
  await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: q.id, text: "Ja" });
  for (let i = 0; i < 200 && w.runner.isActive("tennis-club"); i++) await sleep(20);
  const iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(iv.status, "finished");
  assert.deepEqual(iv.finish_blockers, []);
  const rec = (await w.call("GET", `/api/runs/${iv.log.runs[0].run_id}`)).body;
  assert.equal(rec.exit_reason, "finished");
  assert.equal(rec.model, "claude-opus-5-5");
  assert.equal(rec.effort, "medium");
  assert.equal(rec.billing_mode, "api");
  assert.match(rec.skill_sha256, /^[a-f0-9]{64}$/);
  assert.ok(rec.tool_calls >= 16);
  assert.deepEqual(rec.tools_offered, ["mcp__factory__ask_human"]);
  assert.equal(rec.usage.calls, 0);
  assert.ok([...w.docker.containers.values()].every((c) => c.removed), "container removed");
  assert.deepEqual(readdirSync(w.dirs.tokens), [], "token revoked");
  assert.deepEqual(readdirSync(w.dirs.runs), [], "run folder removed");
  assert.ok(seenEnv.some((e) => /^ANTHROPIC_API_KEY=[a-f0-9]{64}$/.test(e)), "a per-run token, not a key");
  assert.ok(seenEnv.includes("CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0"));
  assert.ok(seenEnv.includes("ANTHROPIC_BASE_URL=http://model-gateway:8080"));
  assert.match((await w.call("GET", "/api/projects/tennis-club/interview/prd.md")).body, /## 1 Vision\n> Status: confirmed/);
  assert.match((await w.call("GET", "/api/projects/tennis-club/interview/features.md")).body, /F-001/);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 409, "finished");
  assert.ok(w.logs.some((l) => l.action === "tool_call" && l.tool === "finish_interview"));
  w.api.close();
});

test("pause by the human, then the answer resumes the interview in a fresh run that gets it", async () => {
  let runs = 0;
  let prompt2 = "";
  const w = await world(async ({ runId, c }) => {
    runs++;
    if (runs === 1) {
      await tool(w.dirs, runId, "read_briefing", {});
      await tool(w.dirs, runId, "update_prd_section", { section: 1, status: "drafted", content: "Court booking", source: "briefing/notes.md" });
      tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "Members only?", recommendation: { answer: "Yes", reason: "r" } });
      await new Promise(() => {}); // waits until the factory stops the container (fake stop ends it)
    }
    prompt2 = readFileSync(join(w.dirs.runs, runId, "in", "prompt.md"), "utf8");
    return 0;
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  for (;;) { if ((await w.call("GET", "/api/projects/tennis-club/interview")).body.status === "waiting_for_human") break; await sleep(10); }
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/pause", {})).status, 200);
  for (let i = 0; i < 200 && w.runner.isActive("tennis-club"); i++) await sleep(10);
  let iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(iv.status, "paused");
  assert.equal(iv.last_exit_reason, "paused_by_human");
  assert.equal(iv.prd[1].status, "drafted", "drafts kept");
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/pause", {})).status, 409);
  // the answer resumes the interview in a fresh run by itself (block 3 scope finding 1)
  const ans = (await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "Nur Mitglieder" })).body;
  assert.equal(ans.delivered, false);
  assert.match(ans.resumed, /^run-/);
  for (let i = 0; i < 200 && w.runner.isActive("tennis-club"); i++) await sleep(10);
  assert.match(prompt2, /mode: resume/);
  assert.match(prompt2, /Members only\? → answer: Nur Mitglieder/);
  assert.match(prompt2, /### 1 Vision – drafted/);
  iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(iv.last_exit_reason, "ended_without_finish");
  assert.equal(iv.log.runs.length, 2);
  w.api.close();
});

test("the ask_human wait time ends the run like a pause (G2.2); idle runs are stopped (G13.1)", async () => {
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" } });
    await new Promise(() => {});
  });
  await newProject(w);
  // minutes are the unit in settings; the test shortens the timer through the runner's state
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  const [id, st] = [...w.runner.active][0];
  st.waitMs = 50;
  for (let i = 0; i < 300 && w.runner.isActive("tennis-club"); i++) await sleep(10);
  assert.equal(w.runner.runRecord(id).exit_reason, "paused_wait_timeout");
  assert.equal((await w.call("GET", "/api/projects/tennis-club/interview")).body.status, "paused");

  const w2 = await world(async () => { await new Promise(() => {}); });
  await newProject(w2);
  await w2.call("POST", "/api/projects/tennis-club/interview/start", {});
  const [id2, st2] = [...w2.runner.active][0];
  clearTimeout(st2.timers.idle);
  st2.idleMs = 30;
  w2.runner.active.get(id2) && (st2.timers.idle = setTimeout(() => w2.runner.stop(id2, "idle_timeout"), 30));
  for (let i = 0; i < 300 && w2.runner.isActive("tennis-club"); i++) await sleep(10);
  assert.equal(w2.runner.runRecord(id2).exit_reason, "idle_timeout");
  w.api.close(); w2.api.close();
});

test("start checks: empty briefing, failed container start; restart recovery", async () => {
  const w = await world(async () => 0);
  await w.call("POST", "/api/projects", { name: "Empty One" });
  assert.equal((await w.call("POST", "/api/projects/empty-one/interview/start", {})).status, 409);
  await newProject(w);
  w.docker.create = async () => { throw new Error("no such image"); };
  const r = await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.equal(r.status, 500);
  assert.match(r.body.error, /could not start/);
  assert.equal((await w.call("GET", "/api/projects/tennis-club/interview")).body.last_exit_reason, "start_failed");
  // a factory restart while a run was active
  const iv = w.interview.load("tennis-club");
  iv.active_run = "run-ghost1"; iv.status = "running";
  w.interview.save("tennis-club", iv);
  writeJson(join(w.dirs.data, "runs", "run-ghost1", "run.json"), { run_id: "run-ghost1", ended_at: null });
  writeFileSync(join(w.dirs.tokens, "deadbeef"), "{}");
  writeFileSync(join(w.dirs.usage, "run-ghost1.jsonl"), JSON.stringify({ status: 200, model: "claude-opus-5-5", complete: true, input_tokens: 1000, output_tokens: 10 }) + "\n");
  w.docker.containers.set("cghost", { spec: { Labels: { "dev.levuvo-sf.run": "run-ghost1" } }, removed: false });
  await w.runner.recover(["tennis-club"]);
  assert.equal(w.interview.load("tennis-club").last_exit_reason, "factory_restarted");
  const ghost = w.runner.runRecord("run-ghost1");
  assert.equal(ghost.exit_reason, "factory_restarted");
  assert.equal(ghost.usage.input_tokens, 1000, "usage kept (branch review finding 4)");
  assert.equal(ghost.usage.cost_is_lower_bound, true);
  assert.ok(existsSync(join(w.dirs.data, "runs", "run-ghost1", "transcript.jsonl")), "transcript of the leftover container kept");
  assert.equal(w.docker.containers.get("cghost").removed, true);
  assert.deepEqual(readdirSync(w.dirs.tokens), []);
  w.api.close();
});

const waitEnd = async (w, slug = "tennis-club") => { for (let i = 0; i < 300 && w.runner.isActive(slug); i++) await sleep(10); };

test("the tool channel refuses links and stops a run whose folders were replaced (branch review finding 5)", async () => {
  let linkResult;
  const w = await world(async ({ runId }) => {
    const io = join(w.dirs.runs, runId, "io");
    assert.equal(statSync(join(io, "req")).mode & 0o7777, 0o1733, "req: create only, sticky");
    assert.equal(statSync(join(io, "res")).mode & 0o7777, 0o755, "res: read only for the run");
    // a request that is a link to a file of the factory
    writeFileSync(join(w.dirs.data, "secret.json"), '"factory-only content"');
    symlinkSync(join(w.dirs.data, "secret.json"), join(io, "req", "abc-111111111111.json"));
    for (let i = 0; i < 100 && !existsSync(join(io, "res", "abc-111111111111.json")); i++) await sleep(10);
    linkResult = readFileSync(join(io, "res", "abc-111111111111.json"), "utf8");
    // the answer folder replaced by a link: the factory stops the run instead of writing through it
    rmSync(join(io, "res"), { recursive: true });
    symlinkSync(w.dirs.data, join(io, "res"));
    await new Promise(() => {});
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  await waitEnd(w);
  assert.match(linkResult, /not a regular file/);
  assert.doesNotMatch(linkResult, /factory-only/);
  const id = w.interview.load("tennis-club").log.runs[0].run_id;
  assert.equal(w.runner.runRecord(id).exit_reason, "channel_tampered");
  assert.ok(!readdirSync(w.dirs.data).some((f) => f.endsWith(".json") && f.startsWith("abc-")), "nothing written into the factory's data");
  w.api.close();
});

test("the same failing call three times in a row stops the run (G13.1, branch review finding 10)", async () => {
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    for (let i = 0; i < 3; i++) await tool(w.dirs, runId, "read_briefing", { path: "briefing/missing.md" });
    await new Promise(() => {});
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  await waitEnd(w);
  const iv = w.interview.load("tennis-club");
  assert.equal(iv.last_exit_reason, "repeated_failure");
  assert.equal(iv.log.runs[0].end_reason, "failed");
  w.api.close();
});

test("token renewed while the run lives; docker compose stop ends runs cleanly (branch review findings 8 and 2)", async () => {
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" } });
    await new Promise(() => {});
  }, { ask_human_wait_minutes: 1440 });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  for (let i = 0; i < 200 && w.interview.load("tennis-club").status !== "waiting_for_human"; i++) await sleep(10);
  const [tok] = readdirSync(w.dirs.tokens);
  const left = Date.parse(JSON.parse(readFileSync(join(w.dirs.tokens, tok), "utf8")).expires_at) - Date.now();
  assert.ok(left > 24 * 3600_000, "valid beyond the longest allowed wait");
  const ids = await w.runner.shutdown();
  assert.equal(ids.length, 1);
  assert.equal(w.runner.isActive("tennis-club"), false);
  assert.deepEqual(readdirSync(w.dirs.tokens), [], "token revoked");
  assert.ok([...w.docker.containers.values()].every((c) => c.removed), "container removed");
  assert.equal(w.runner.runRecord(ids[0]).exit_reason, "factory_stopped");
  const iv = w.interview.load("tennis-club");
  assert.equal(iv.status, "paused");
  assert.equal(iv.log.runs[0].end_reason, "paused");
  w.api.close();
});

test("agent outputs and the transcript are secret-scanned at the end; findings are shown, nothing changed (branch review finding 9)", async () => {
  let n = 0;
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    await tool(w.dirs, runId, "update_prd_section", { section: 1, status: "drafted", content: ++n === 1 ? "key AKIA-LIKE" : "clean now", source: "briefing/notes.md" });
    return 0;
  }, {}, { scan: async (buf) => (buf.toString().includes("AKIA-LIKE") ? 1 : 0) });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  await waitEnd(w);
  const view = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(view.output_secret_scan.status, "findings");
  assert.equal(view.prd[1].content, "key AKIA-LIKE", "nothing changed silently");
  assert.equal(w.runner.runRecord(view.log.runs[0].run_id).output_secret_scan.findings, 1);
  // the next run is clean: the view shows the latest result, the old run record keeps its finding (re-check finding 3)
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  await waitEnd(w);
  const view2 = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(view2.output_secret_scan.status, "clean");
  assert.equal(w.runner.runRecord(view.log.runs[0].run_id).output_secret_scan.status, "findings");
  w.api.close();
});

test("parallel briefing uploads both land in the inventory (branch review finding 6)", async () => {
  const w = await world(async () => 0);
  await newProject(w);
  const up = (name) => w.call("PUT", "/api/projects/tennis-club/briefing", { path: name, content_base64: Buffer.from(`content of ${name}`).toString("base64") });
  const rs = await Promise.all(["a.md", "b.md", "c.md", "d.md"].map(up));
  assert.ok(rs.every((r) => r.status === 200));
  const inv = (await w.call("GET", "/api/projects/tennis-club/briefing")).body;
  assert.deepEqual(inv.files.map((f) => f.path).sort(), ["briefing/a.md", "briefing/b.md", "briefing/c.md", "briefing/d.md", "briefing/notes.md"]);
  w.api.close();
});

test("shutdown while a container is being created: no orphan container, no token, no new runs (re-check finding 1)", async () => {
  const w = await world(async () => { await new Promise(() => {}); });
  await newProject(w);
  let release;
  const gate = new Promise((r) => { release = r; });
  const create = w.docker.create;
  w.docker.create = async (...a) => { await gate; return create(...a); };
  const started = w.call("POST", "/api/projects/tennis-club/interview/start", {});
  for (let i = 0; i < 100 && !w.runner.isActive("tennis-club"); i++) await sleep(5);
  const down = w.runner.shutdown();
  await sleep(30);
  release();
  const ids = await down;
  assert.equal((await started).status, 200);
  assert.equal(ids.length, 1);
  assert.ok([...w.docker.containers.values()].every((c) => c.removed), "the late container was stopped and removed");
  assert.deepEqual(readdirSync(w.dirs.tokens), []);
  assert.equal(w.runner.runRecord(ids[0]).exit_reason, "factory_stopped");
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 503);
  w.api.close();
});

test("web search per project: off by default; when the owner switches it on, run record, container and gateway token all say so", async () => {
  for (const on of [false, true]) {
    let env = null;
    const w = await world(async ({ runId, c }) => { env = c.spec.Env; await tool(w.dirs, runId, "read_briefing", {}); await new Promise(() => {}); });
    await newProject(w);
    assert.equal((await w.call("GET", "/api/projects/tennis-club")).body.web_search, false, "off for every new project");
    if (on) assert.equal((await w.call("PUT", "/api/projects/tennis-club", { web_search: true })).body.web_search, true);
    const r = await w.call("POST", "/api/projects/tennis-club/interview/start", {});
    for (let i = 0; i < 200 && !env; i++) await sleep(10);
    const [tok] = readdirSync(w.dirs.tokens);
    assert.deepEqual(JSON.parse(readFileSync(join(w.dirs.tokens, tok), "utf8")).server_tools, on ? ["web_search"] : []);
    assert.ok(env.includes(`LEVUVO_SF_WEB_SEARCH=${on ? 1 : 0}`));
    assert.equal(w.runner.runRecord(r.body.run_id).web_search, on);
    await w.runner.shutdown();
    w.api.close();
  }
});

// ---- block 3: answers with attachments, resume on answer, robust run end, delete project, the web UI files ----

const b64 = (t) => Buffer.from(t).toString("base64");
const waitFor = async (fn, ms = 3000) => { for (let i = 0; i < ms / 10; i++) { if (await fn()) return true; await sleep(10); } return false; };

test("answer attachments: screened first, a secret refuses the whole answer and leaves nothing; stored ones reach the waiting run (G2.5)", async () => {
  let result = null;
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    result = await tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "Show us the paper list?", recommendation: { answer: "Photo", reason: "r" } });
    const read = await tool(w.dirs, runId, "read_briefing", { path: "briefing/answers/Q-001/list.md" });
    result.read = read;
    await tool(w.dirs, runId, "update_prd_section", { section: 2, status: "drafted", content: "Paper list.", source: "attachment briefing/answers/Q-001/list.md" }).then((r) => { result.source = r; });
    return 0;
  }, {}, { scanFiles: async (buf) => (buf.toString().includes("AKIA") ? 1 : 0) });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.ok(await waitFor(async () => (await w.call("GET", "/api/projects/tennis-club/interview")).body.status === "waiting_for_human"));
  const send = (attachments, text = "Hier") => w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text, attachments });
  const inv0 = (await w.call("GET", "/api/projects/tennis-club/briefing")).body.version;
  const bad = await send([{ name: "list.md", content_base64: b64("Court 1 Mo 9-10") }, { name: "keys.txt", content_base64: b64("aws_access_key_id = AKIAZ7Q3XK4N2TJ5WB6M") }]);
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /keys\.txt: blocked/);
  assert.equal((await w.call("GET", "/api/projects/tennis-club/briefing")).body.version, inv0, "a refused answer stores nothing");
  assert.ok(!existsSync(join(w.dirs.data, "projects/tennis-club/briefing/answers")));
  assert.equal((await w.call("GET", "/api/projects/tennis-club/interview")).body.open_question.id, "Q-001", "the question stays open");
  assert.equal((await send([{ name: "a.md", content_base64: b64("x") }, { name: "a.md", content_base64: b64("y") }])).status, 400, "the same name twice");
  assert.equal((await send([{ name: "../x.md", content_base64: b64("x") }])).status, 400);
  const ok = await send([{ name: "list.md", content_base64: b64("Court 1 Mo 9-10") }], "");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.delivered, true);
  assert.ok(await waitFor(() => result?.source));
  const answerText = textOf(result);
  assert.match(answerText, /briefing\/answers\/Q-001\/list\.md/);
  assert.match(answerText, /Read every readable one now/);
  assert.match(textOf(result.read), /Court 1 Mo 9-10/);
  assert.equal(result.source.isError, undefined, "attachment <path> is a valid source");
  const iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  const att = iv.log.entries[0].answer.attachments;
  assert.equal(att[0].path, "briefing/answers/Q-001/list.md");
  assert.match(att[0].sha256, /^[a-f0-9]{64}$/);
  const file = (await w.call("GET", "/api/projects/tennis-club/briefing")).body.files.find((f) => f.path === att[0].path);
  assert.deepEqual([file.added_via, file.answer_ref], ["answer", "Q-001"]);
  assert.deepEqual(iv.outdated, [], "an answer attachment does not make the interview outdated (GA2.3)");
  // bound to the answer: the ordinary briefing endpoints cannot replace or delete it
  assert.equal((await w.call("PUT", "/api/projects/tennis-club/briefing", { path: "answers/Q-001/list.md", content_base64: b64("changed") })).status, 403);
  assert.equal((await w.call("PUT", "/api/projects/tennis-club/briefing", { path: "answers/Q-009/new.md", content_base64: b64("planted") })).status, 403);
  assert.equal((await w.call("DELETE", "/api/projects/tennis-club/briefing", { path: "answers/Q-001/list.md" })).status, 403);
  await w.runner.shutdown();
  w.api.close();
});

test("an answer without text needs an attachment; the resumed run gets the attachment paths", async () => {
  let n = 0, prompt2 = "";
  const w = await world(async ({ runId }) => {
    if (++n === 1) {
      await tool(w.dirs, runId, "read_briefing", {});
      tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "Photo?", recommendation: { answer: "Yes", reason: "r" } });
      await new Promise(() => {});
    }
    prompt2 = readFileSync(join(w.dirs.runs, runId, "in", "prompt.md"), "utf8");
    return 0;
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.ok(await waitFor(async () => (await w.call("GET", "/api/projects/tennis-club/interview")).body.status === "waiting_for_human"));
  await w.call("POST", "/api/projects/tennis-club/interview/pause", {});
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: " " })).status, 400);
  const r = await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", attachments: [{ name: "photo.png", content_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]).toString("base64") }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.resumed, /^run-/);
  assert.ok(await waitFor(() => prompt2));
  assert.match(prompt2, /attachments: briefing\/answers\/Q-001\/photo\.png/);
  assert.match(prompt2, /not read yet: briefing\/answers\/Q-001\/photo\.png/);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "again" })).status, 409, "never twice");
  await w.runner.shutdown();
  w.api.close();
});

test("a failing run end never leaves the interview running; the next start cleans up and runs (block 3 scope finding 2)", async () => {
  let n = 0;
  const w = await world(async ({ runId }) => {
    n++;
    await tool(w.dirs, runId, "read_briefing", {});
    if (n === 1) mkdirSync(join(w.dirs.data, "runs", runId, "transcript.jsonl", "x"), { recursive: true }); // the transcript cannot be written: the run end fails half-way
    return 0;
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.ok(await waitFor(() => w.logs.some((l) => l.action === "finish_failed")));
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  const iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.deepEqual([iv.status, iv.active_run, iv.last_exit_reason], ["paused", null, "finish_failed"]);
  // the run record is closed too, with the usage the gateway saw (branch finding 5)
  const rec = w.runner.runRecord(iv.log.runs[0].run_id);
  assert.deepEqual([rec.exit_reason, !!rec.ended_at, rec.usage.cost_is_lower_bound], ["finish_failed", true, true]);
  assert.equal(iv.log.runs[0].end_reason, "paused");
  const r = await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  assert.equal((await w.call("GET", "/api/projects/tennis-club/interview")).body.last_exit_reason, "ended_without_finish");
  w.api.close();
});

test("a stored run nobody owns shows as paused and is reconciled before the next start: container removed, token revoked, record closed", async () => {
  const w = await world(async () => 0);
  await newProject(w);
  // what a half-failed run end leaves behind: interview still "running", its container and its token
  const iv = w.interview.load("tennis-club");
  Object.assign(iv, { status: "running", active_run: "run-ghost1" });
  iv.log.runs.push({ run_id: "run-ghost1", started_at: new Date().toISOString() });
  w.interview.save("tennis-club", iv);
  writeJson(join(w.dirs.data, "runs/run-ghost1/run.json"), { run_id: "run-ghost1", ended_at: null, tool_calls: 0 });
  const ghost = await w.docker.create("levuvo-sf-run-ghost1", { Labels: { "dev.levuvo-sf.run": "run-ghost1", "dev.levuvo-sf.project": "levuvo-sf-test" } });
  writeFileSync(join(w.dirs.tokens, "abc"), JSON.stringify({ run_id: "run-ghost1" }));
  const view = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.deepEqual([view.status, view.active_run], ["paused", null], "shown as paused, so the owner can resume");
  assert.equal((await w.call("GET", "/api/projects")).body[0].interview.status, "paused");
  // a cleanup that fails refuses the start
  const list = w.docker.list;
  w.docker.list = async () => { throw new Error("docker-proxy down"); };
  const refused = await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.equal(refused.status, 503);
  assert.match(refused.body.error, /could not be cleaned up/);
  w.docker.list = list;
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 200);
  assert.ok(w.docker.containers.get(ghost.Id).removed, "the old container is gone");
  assert.ok(!existsSync(join(w.dirs.tokens, "abc")), "the old token is revoked");
  assert.equal(w.runner.runRecord("run-ghost1").exit_reason, "finish_failed");
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  w.api.close();
});

test("a finished interview stays finished; a briefing change before the PRD approval reopens it (block 3 scope finding 7)", async () => {
  const w = await world(async () => 0);
  await newProject(w);
  const iv = w.interview.load("tennis-club");
  Object.assign(iv, { status: "finished", summary: "done" });
  iv.log.status = "finished";
  iv.log.inventory_version_read = 1;
  iv.prd[2] = { status: "confirmed", content: "Paper list.", source: "briefing/notes.md", answer_ref: "Q-001" };
  w.interview.save("tennis-club", iv);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 409, "finished stays finished");
  await w.call("PUT", "/api/projects/tennis-club/briefing", { path: "notes.md", content_base64: b64("Court booking, now with guests") });
  const after = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.deepEqual([after.status, after.last_exit_reason, after.outdated, after.prd[2].status], ["paused", "briefing_changed_after_finish", ["briefing/notes.md"], "drafted"]);
  assert.ok(after.finish_blockers.length > 0, "it must be finished again");
  w.api.close();
});

test("delete project: typed name, refused while a run is active, repository first, retryable after a failure, serialized with starts", async () => {
  const git = [];
  let fail = true;
  const w = await world(async ({ runId }) => { await tool(w.dirs, runId, "read_briefing", {}); await new Promise(() => {}); }, {}, {
    gitApi: async (method, path) => { git.push(`${method} ${path}`); if (fail && method === "DELETE") throw Object.assign(new Error("git server: 500"), { status: 500 }); return method === "GET" ? { id: 7 } : null; },
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.equal((await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis" })).status, 400, "the name must match");
  assert.equal((await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" })).status, 409, "pause first");
  await w.call("POST", "/api/projects/tennis-club/interview/pause", {});
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  const runId = (await w.call("GET", "/api/projects/tennis-club/interview")).body.log.runs[0].run_id;
  // a start that arrives while the deletion runs waits for it and is then refused
  const [d1, s1] = await Promise.all([w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" }), w.call("POST", "/api/projects/tennis-club/interview/start", {})]);
  assert.equal(d1.status, 502);
  assert.match(d1.body.error, /could not be deleted.*try again/);
  assert.equal(s1.status, 409);
  assert.equal((await w.call("GET", "/api/projects/tennis-club")).body.deleting, true, "marked, so it can be retried");
  for (const [m, p, b] of [["PUT", "/briefing", { path: "x.md", content_base64: b64("x") }], ["DELETE", "/briefing", { path: "notes.md" }], ["POST", "/interview/start", {}], ["POST", "/interview/answer", { question_id: "Q-001", text: "x" }], ["PUT", "", { web_search: true }]]) {
    assert.equal((await w.call(m, `/api/projects/tennis-club${p}`, b)).status, 409, `${m} ${p} while deleting`);
  }
  fail = false;
  const d2 = await w.call("DELETE", "/api/projects/tennis-club", { confirm: "tennis-club" });
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  assert.deepEqual(git, ["GET /repos/levuvo-sf/tennis-club", "DELETE /repos/levuvo-sf/tennis-club", "GET /repos/levuvo-sf/tennis-club", "DELETE /repos/levuvo-sf/tennis-club"], "only its own repository, checked first");
  assert.equal((await w.call("GET", "/api/projects/tennis-club")).status, 404);
  assert.ok(!existsSync(join(w.dirs.data, "runs", runId)), "its run records are gone too");
  assert.deepEqual((await w.call("GET", "/api/projects")).body, []);
  w.api.close();
});

test("delete project: an already missing repository counts as deleted", async () => {
  const w = await world(async () => 0, {}, { gitApi: async () => { throw Object.assign(new Error("git server: 404"), { status: 404 }); } });
  await newProject(w);
  assert.equal((await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" })).status, 200);
  w.api.close();
});

test("project properties: only web_search, only true or false; the list carries what the inbox needs", async () => {
  const w = await world(async ({ runId }) => { await tool(w.dirs, runId, "read_briefing", {}); tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "Members only?", recommendation: { answer: "Yes", reason: "r" } }); await new Promise(() => {}); });
  await newProject(w);
  assert.equal((await w.call("PUT", "/api/projects/tennis-club", { web_search: "on" })).status, 400);
  assert.equal((await w.call("PUT", "/api/projects/tennis-club", { name: "x" })).status, 400);
  assert.equal((await w.call("PUT", "/api/projects/nope-nope", { web_search: true })).status, 404);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.ok(await waitFor(async () => (await w.call("GET", "/api/projects")).body[0].interview.open_question));
  const [p] = (await w.call("GET", "/api/projects")).body;
  assert.equal(p.briefing_files, 1);
  assert.deepEqual([p.interview.status, p.interview.active, p.interview.open_question.id, p.interview.open_question.decision_needed], ["waiting_for_human", true, "Q-001", "Members only?"]);
  assert.equal((await w.call("GET", "/api/projects/tennis-club/interview")).body.open_question.id, "Q-001");
  await w.runner.shutdown();
  w.api.close();
});

test("delete project: fails closed on a foreign repository and when an earlier run cannot be cleaned up (branch findings 2 and 6)", async () => {
  const git = [];
  let id = 8;
  const w = await world(async () => 0, {}, { gitApi: async (method, path) => { git.push(`${method} ${path}`); return method === "GET" ? { id } : null; } });
  await newProject(w);
  // the repository at the path is not the one the factory created (another id): nothing is deleted
  const d1 = await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" });
  assert.equal(d1.status, 409);
  assert.match(d1.body.error, /not this project's repository/);
  assert.deepEqual(git, ["GET /repos/levuvo-sf/tennis-club"]);
  assert.equal(w.projects.get("tennis-club").deleting, undefined, "not marked: the project stays usable (re-check finding 3)");
  // a leftover run container that cannot be removed refuses the deletion before anything changes
  const ghost = await w.docker.create("levuvo-sf-run-ghost1", { Labels: { "dev.levuvo-sf.run": "run-ghost1", "dev.levuvo-sf.project": "levuvo-sf-test" } });
  w.docker.remove = async () => { throw new Error("docker-proxy down"); };
  git.length = 0;
  id = 7;
  const d2 = await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" });
  assert.equal(d2.status, 503);
  assert.match(d2.body.error, /could not be cleaned up/);
  assert.deepEqual(git, [], "the repository is untouched");
  w.docker.remove = async (cid) => { w.docker.containers.get(cid).removed = true; };
  assert.equal((await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" })).status, 200);
  assert.ok(w.docker.containers.get(ghost.Id).removed, "the leftover container went first");
  // a project whose repository record names another repository is refused
  await newProject(w);
  writeJson(join(w.dirs.data, "projects/tennis-club/project.json"), { ...w.projects.get("tennis-club"), repo: { org: "levuvo-sf", name: "other" } });
  const d3 = await w.call("DELETE", "/api/projects/tennis-club", { confirm: "Tennis Club" });
  assert.equal(d3.status, 409);
  assert.match(d3.body.error, /does not match/);
  w.api.close();
});

test("no second run while one of the project still ends, whatever the stored status (branch finding 4)", async () => {
  let release;
  const w = await world(async ({ runId }) => { await tool(w.dirs, runId, "read_briefing", {}); await new Promise((r) => { release = r; }); return 0; });
  await newProject(w);
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/start", {})).status, 200);
  assert.ok(await waitFor(() => release));
  const iv = w.interview.load("tennis-club");
  iv.status = "paused"; // e.g. a briefing change right after finish_interview, before the container has ended
  w.interview.save("tennis-club", iv);
  const r = await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /still active or ending/);
  release();
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  w.api.close();
});

test("an answer that arrives while the run ends is not handed to it; the interview resumes once after the end (branch finding 3)", async () => {
  let runs = 0;
  let stopHit;
  const w = await world(async ({ runId }) => {
    runs++;
    if (runs === 1) {
      await tool(w.dirs, runId, "read_briefing", {});
      tool(w.dirs, runId, "ask_human", { finding: "f", decision_needed: "Members only?", recommendation: { answer: "Yes", reason: "r" } });
      await new Promise(() => {});
    }
    return 0;
  });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  assert.ok(await waitFor(async () => (await w.call("GET", "/api/projects/tennis-club/interview")).body.status === "waiting_for_human"));
  // the container takes a while to stop: the answer comes in between
  const stop = w.docker.stop;
  w.docker.stop = async (cid) => { await new Promise((r) => { stopHit = r; }); return stop(cid); };
  const paused = w.call("POST", "/api/projects/tennis-club/interview/pause", {});
  assert.ok(await waitFor(() => stopHit));
  const ans = w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "Nur Mitglieder" });
  await sleep(50);
  stopHit();
  await paused;
  const body = (await ans).body;
  assert.equal(body.delivered, false, "never handed to the ending run");
  assert.match(body.resumed, /^run-/, "resumed after the end");
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  const iv = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(iv.log.runs.length, 2, "exactly one new run");
  assert.equal(iv.log.entries[0].answer.text, "Nur Mitglieder");
  w.api.close();
});

test("an answer to a run whose end failed half-way still resumes; leftover unbound attachments are removed (re-check findings 1 and 2)", async () => {
  let runs = 0;
  const w = await world(async () => { runs++; return 0; });
  await newProject(w);
  const iv = w.interview.load("tennis-club");
  // a run that asked, then ended without its end being saved: the interview still says waiting, nobody runs it
  iv.log.runs.push({ run_id: "run-ghost1", started_at: new Date().toISOString() });
  Object.assign(iv, { status: "running", active_run: "run-ghost1" });
  w.interview.save("tennis-club", iv);
  w.interview.call("tennis-club", { id: "run-ghost1" }, "read_briefing", {});
  assert.ok(w.interview.call("tennis-club", { id: "run-ghost1" }, "ask_human", { finding: "f", decision_needed: "Members only?", recommendation: { answer: "Yes", reason: "r" } }).wait);
  assert.equal(w.interview.load("tennis-club").status, "waiting_for_human");
  writeJson(join(w.dirs.data, "runs/run-ghost1/run.json"), { run_id: "run-ghost1", ended_at: null, tool_calls: 0 });
  // an earlier answer attempt stored a file, then the factory stopped before the answer was saved
  w.briefing.storeAttachments("tennis-club", await w.briefing.screenAttachments("Q-001", [{ name: "old.md", content_base64: b64("old") }]));
  const ans = (await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "Nur Mitglieder" })).body;
  assert.equal(ans.delivered, false, JSON.stringify(ans));
  assert.match(ans.resumed, /^run-/, JSON.stringify(ans));
  assert.ok(!w.briefing.inventory("tennis-club").files.some((f) => f.path.startsWith("briefing/answers/")), "the unbound attachment is gone");
  assert.equal(w.runner.runRecord("run-ghost1").exit_reason, "finish_failed");
  assert.ok(await waitFor(() => !w.runner.isActive("tennis-club")));
  assert.equal(runs, 1);
  w.api.close();
});

test("only the current question can be answered; an older unanswered one stays history (branch finding 7)", async () => {
  const w = await world(async () => 0);
  await newProject(w);
  const iv = w.interview.load("tennis-club");
  const q = (id, d) => ({ question: { id, finding: "f", decision_needed: d, recommendation: { answer: "a", reason: "r" }, asked_at: new Date().toISOString() } });
  iv.log.entries.push(q("Q-001", "Old?"), q("Q-002", "New?"));
  Object.assign(iv, { status: "paused", next_question: 3 });
  w.interview.save("tennis-club", iv);
  assert.equal((await w.call("GET", "/api/projects")).body[0].interview.open_question.id, "Q-002");
  const old = await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "x" });
  assert.equal(old.status, 409);
  assert.match(old.body.error, /no longer open/);
  const fin = w.interview.load("tennis-club");
  fin.status = "finished";
  w.interview.save("tennis-club", fin);
  assert.equal((await w.call("GET", "/api/projects")).body[0].interview.open_question, null, "a finished interview offers nothing");
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-002", text: "x" })).status, 409);
  w.api.close();
});

test("web UI: only the bundled files, from memory, with a strict CSP; nothing uploaded is ever served (block 3 scope finding 8)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(dir, "app.js"), "export {};");
  writeFileSync(join(dir, "style.css"), "body{}");
  writeFileSync(join(dir, "logo.svg"), "<svg/>");
  writeFileSync(join(dir, ".secret.js"), "no");
  writeFileSync(join(dir, "notes.txt"), "unknown type");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "x.js"), "no");
  const { loadUi } = await import("../src/server.mjs");
  const ui = loadUi(dir);
  assert.deepEqual([...ui.keys()].sort(), ["/", "/app.js", "/index.html", "/logo.svg", "/style.css"]);
  assert.equal(loadUi(join(dir, "missing")).size, 0);
  writeFileSync(join(dir, "app.js"), "changed on disk later");
  const w = await world(async () => 0, {}, { ui });
  await newProject(w);
  const raw = (path, method = "GET", headers = {}) => new Promise((resolve) => {
    request({ host: "127.0.0.1", port: w.api.address().port, method, path, headers: { host: "localhost:3100", ...headers } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)).on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).end();
  });
  const index = await raw("/");
  assert.equal(index.status, 200);
  assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
  assert.match(index.headers["content-security-policy"], /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.match(index.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  const js = await raw("/app.js");
  assert.deepEqual([js.headers["content-type"], js.body], ["text/javascript; charset=utf-8", "export {};"], "served from memory");
  assert.equal((await raw("/logo.svg")).headers["content-type"], "image/svg+xml");
  for (const p of ["/.secret.js", "/notes.txt", "/sub/x.js", "/%2e%2e/etc/passwd", "/briefing/notes.md", "/projects/tennis-club/briefing/notes.md", "/api/projects/tennis-club/briefing/notes.md"]) {
    assert.notEqual((await raw(p)).status, 200, p);
  }
  assert.equal((await raw("/", "POST")).status, 405);
  assert.equal((await raw("/", "GET", { host: "evil.example:3100" })).status, 421, "the Host check covers the UI too");
  w.api.close();
});
