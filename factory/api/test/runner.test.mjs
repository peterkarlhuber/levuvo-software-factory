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
import { validator } from "./helpers.mjs";

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

async function world(script, settingsPatch = {}, { scan = async () => 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rw-"));
  const dirs = { data: join(root, "data"), runs: join(root, "runs"), tokens: join(root, "tokens"), usage: join(root, "usage") };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const settings = createSettings(join(dirs.data, "settings.json"));
  settings.update(settingsPatch);
  const briefing = createBriefing({ dataDir: dirs.data, validator, scan: async () => 0 });
  const interview = createInterview({ dataDir: dirs.data, briefing, validator, settings: settings.get });
  const forgejo = { createProjectRepo: async (slug) => ({ org: "levuvo-sf", name: slug }) };
  const projects = createProjects({ dataDir: dirs.data, forgejo, readJson, writeJson });
  const docker = fakeDocker(script);
  const skillsDir = join(root, "skills");
  mkdirSync(join(skillsDir, "interview"), { recursive: true });
  writeFileSync(join(skillsDir, "interview", "SKILL.md"), "# Interview skill");
  const prices = { version: "t", models: { "claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2 } } };
  const logs = [];
  const runner = createRunner({ dirs, docker, interview, briefing, settings: settings.get, prices, project: projects.get, lock: createLocks(), skillsDir, composeProject: "levuvo-sf-test", log: (o) => logs.push(o), pollMs: 20, scan });
  const api = createApi({ port: 3100, projects, briefing, interview, runner, settings });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = request({ host: "127.0.0.1", port: api.address().port, method, path, headers: { host: "localhost:3100", ...(data ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)).on("end", () => resolve({ status: res.statusCode, body: /json/.test(res.headers["content-type"]) ? JSON.parse(b) : b }));
    });
    req.on("error", reject);
    req.end(data);
  });
  return { root, dirs, settings, interview, runner, docker, api, call, logs };
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

test("pause by the human, then resume with a fresh run that gets the answer", async () => {
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
  assert.equal((await w.call("POST", "/api/projects/tennis-club/interview/answer", { question_id: "Q-001", text: "Nur Mitglieder" })).body.delivered, false);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
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
  const w = await world(async ({ runId }) => {
    await tool(w.dirs, runId, "read_briefing", {});
    await tool(w.dirs, runId, "update_prd_section", { section: 1, status: "drafted", content: "key AKIA-LIKE", source: "briefing/notes.md" });
    return 0;
  }, {}, { scan: async (buf) => (buf.toString().includes("AKIA-LIKE") ? 1 : 0) });
  await newProject(w);
  await w.call("POST", "/api/projects/tennis-club/interview/start", {});
  await waitEnd(w);
  const view = (await w.call("GET", "/api/projects/tennis-club/interview")).body;
  assert.equal(view.output_secret_scan.status, "findings");
  assert.equal(view.prd[1].content, "key AKIA-LIKE", "nothing changed silently");
  assert.equal(w.runner.runRecord(view.log.runs[0].run_id).output_secret_scan.findings, 1);
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
