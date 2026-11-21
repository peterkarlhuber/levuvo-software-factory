// Levuvo SF run orchestration: one interviewer run (A2) in a fresh container (AGENTS.md Architecture, PLAYBOOK G7,
// G2.2, G11.2, G13.1, G13.5).
// Start: settings → per-run token for the model gateway → the run's `in` folder (skill from the factory repo, start
// message, tool list) → container from the fixed template → watch its `io` folder for tool calls.
// End: finished, paused (by the human or after the ask_human wait time), idle stop, turn cap, model error or exit.
// The container is removed, the token revoked, the usage summed and one run record written. Agents never write it.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { readJson, writeAtomic, writeJson } from "./store.mjs";
import { runContainerSpec, LABEL } from "./docker.mjs";
import { TOOLS, startPrompt } from "./interview.mjs";
import { readUsage, summarize } from "./usage.mjs";

const MAX_REQUEST = 256 * 1024;
const TOKEN_HOURS = 12;

export function createRunner({ dirs, docker, interview, briefing, settings, prices, project: projectOf, lock, skillsDir, composeProject, log = () => {}, pollMs = 250 }) {
  const active = new Map(); // runId -> { slug, containerId, pending: Map(reqId -> question), timers, stopReason, seen: Set }

  const runPath = (id) => `${dirs.data}/runs/${id}/run.json`;
  const skillText = () => readFileSync(`${skillsDir}/interview/SKILL.md`, "utf8");

  function tokenFile(token) { return `${dirs.tokens}/${createHash("sha256").update(token).digest("hex")}`; }

  async function start(slug) {
    const r = await lock(slug, () => prepare(slug));
    try {
      const c = await docker.create(`levuvo-sf-${r.id}`, runContainerSpec({ runId: r.id, project: composeProject, env: r.env }));
      r.state.containerId = c.Id;
      await docker.start(c.Id);
    } catch (e) {
      log({ action: "run_start_failed", run: r.id, error: e.message });
      await finish(r.id, "start_failed", e.message);
      throw Object.assign(new Error(`the run could not start: ${e.message}`), { status: 500 });
    }
    const { id, state } = r;
    log({ action: "run_started", run: id, project: slug, model: r.model, effort: r.effort });
    resetIdle(id);
    state.poll = setInterval(() => poll(id).catch((e) => log({ action: "poll_error", run: id, error: e.message })), pollMs);
    docker.wait(state.containerId).then((x) => finish(id, null, null, x?.StatusCode), (e) => finish(id, "failed", e.message));
    return { run_id: id };
  }

  /** Checks and prepares a run under the project lock: record, folders, token, interview status. */
  function prepare(slug) {
    {
      const project = projectOf(slug);
      const iv = interview.load(slug);
      if (iv.status === "running" || iv.status === "waiting_for_human") throw Object.assign(new Error("the interview is already running"), { status: 409 });
      if (iv.status === "finished") throw Object.assign(new Error("the interview is finished"), { status: 409 });
      const inv = briefing.inventory(slug);
      if (!inv.files.length) throw Object.assign(new Error("the briefing is empty: upload at least one file first (GA1.1)"), { status: 409 });
      const s = settings();
      const role = s.roles.interviewer;
      const id = `run-${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
      const skill = skillText();
      const record = {
        run_id: id, project: slug, step: "A2", role: "interviewer", model: role.model, effort: role.effort, billing_mode: s.billing_mode,
        skill: "skills/interview/SKILL.md", skill_sha256: createHash("sha256").update(skill).digest("hex"),
        max_turns: s.max_turns_per_run, started_at: new Date().toISOString(), ended_at: null, exit_reason: null, tool_calls: 0, tools_offered: null,
      };
      // the run's folders: `in` (read-only for the run) and `io` (its only writable place)
      const base = `${dirs.runs}/${id}`;
      for (const d of ["in", "io/req", "io/res"]) mkdirSync(`${base}/${d}`, { recursive: true, mode: 0o755 });
      writeFileSync(`${base}/in/system.md`, skill);
      writeFileSync(`${base}/in/prompt.md`, startPrompt({ project, iv, inventory: inv, lang: s.human_language }));
      writeFileSync(`${base}/in/tools.json`, JSON.stringify(TOOLS));
      const token = randomBytes(32).toString("hex");
      writeAtomic(tokenFile(token), JSON.stringify({ run_id: id, expires_at: new Date(Date.now() + TOKEN_HOURS * 3600_000).toISOString() }), 0o644);
      const waitMs = s.ask_human_wait_minutes * 60_000;
      const env = [
        "ANTHROPIC_BASE_URL=http://model-gateway:8080", `ANTHROPIC_API_KEY=${token}`,
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "DISABLE_AUTOUPDATER=1", "DISABLE_TELEMETRY=1", "DISABLE_ERROR_REPORTING=1",
        "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0", // ask_human must block, not move to the background (scope review finding 4)
        `MCP_TOOL_TIMEOUT=${waitMs + 10 * 60_000}`, // above the wait time; the factory ends the run itself when it is over
        "HOME=/home/node",
        `LEVUVO_SF_MODEL=${role.model}`, `LEVUVO_SF_EFFORT=${role.effort}`, `LEVUVO_SF_MAX_TURNS=${s.max_turns_per_run}`,
      ];
      writeJson(runPath(id), record);
      iv.status = "running";
      iv.active_run = id;
      iv.open_question = null;
      iv.last_exit_reason = null;
      iv.log.runs.push({ run_id: id, started_at: record.started_at });
      interview.save(slug, iv);
      const state = { slug, token, containerId: null, pending: new Map(), stopReason: null, seen: new Set(), timers: {}, waitMs, idleMs: s.idle_stop_minutes * 60_000, base };
      active.set(id, state);
      return { id, env, state, model: role.model, effort: role.effort };
    }
  }

  function resetIdle(id) {
    const st = active.get(id);
    if (!st) return;
    clearTimeout(st.timers.idle);
    if (st.pending.size) return; // waiting for the human: the wait timer applies instead
    st.timers.idle = setTimeout(() => stop(id, "idle_timeout"), st.idleMs);
  }

  /** Reads new tool requests from the run's io folder; validates size, shape and duplicates before execution. */
  async function poll(id) {
    const st = active.get(id);
    if (!st || st.stopReason) return;
    let files;
    try { files = readdirSync(`${st.base}/io/req`).filter((f) => /^[a-z0-9]+-[a-f0-9]{12}\.json$/.test(f)).sort(); } catch { return; }
    for (const f of files) {
      const p = `${st.base}/io/req/${f}`;
      let req;
      try {
        const raw = readFileSync(p);
        unlinkSync(p);
        if (raw.length > MAX_REQUEST) throw new Error("request too large");
        req = JSON.parse(raw.toString("utf8"));
        if (`${req.id}.json` !== f || typeof req.tool !== "string" || typeof req.args !== "object" || req.args === null || Array.isArray(req.args)) throw new Error("malformed request");
      } catch (e) {
        const rid = f.replace(/\.json$/, "");
        respond(id, rid, { content: [{ type: "text", text: `Rejected by the factory: ${e.message}` }], isError: true });
        continue;
      }
      if (st.seen.has(req.id)) continue; // never execute a request twice
      st.seen.add(req.id);
      await handle(id, req);
    }
  }

  async function handle(id, req) {
    const st = active.get(id);
    resetIdle(id);
    const rec = readJson(runPath(id));
    rec.tool_calls += 1;
    writeJson(runPath(id), rec);
    const result = await lock(st.slug, async () => {
      try { return interview.call(st.slug, { id }, req.tool, req.args); }
      catch (e) { log({ action: "tool_error", run: id, tool: req.tool, error: e.message }); return { content: [{ type: "text", text: `The factory could not run ${req.tool}: ${e.message}` }], isError: true }; }
    });
    log({ action: "tool_call", run: id, tool: req.tool, ok: !result.isError });
    if (result.wait) {
      st.pending.set(result.wait.id, req.id);
      clearTimeout(st.timers.idle);
      st.timers.wait = setTimeout(() => stop(id, "paused_wait_timeout"), st.waitMs);
      return;
    }
    respond(id, req.id, result);
  }

  function respond(id, reqId, result) {
    const st = active.get(id);
    if (!st) return;
    writeAtomic(`${st.base}/io/res/${reqId}.json`, JSON.stringify(result), 0o644);
  }

  /** The human's answer: stored in the log; handed to the run if it is waiting for exactly this question. */
  async function answer(slug, questionId, body) {
    return lock(slug, async () => {
      const result = interview.answer(slug, questionId, body);
      for (const [id, st] of active) {
        if (st.slug !== slug || !st.pending.has(questionId)) continue;
        const reqId = st.pending.get(questionId);
        st.pending.delete(questionId);
        clearTimeout(st.timers.wait);
        if (result) respond(id, reqId, result);
        resetIdle(id);
      }
      return { delivered: result !== null };
    });
  }

  async function stop(id, reason) {
    const st = active.get(id);
    if (!st || st.stopReason) return;
    st.stopReason = reason;
    log({ action: "run_stopping", run: id, reason });
    if (st.containerId) await docker.stop(st.containerId, 5).catch((e) => log({ action: "stop_failed", run: id, error: e.message }));
  }

  async function pause(slug) {
    const ids = [...active].filter(([, st]) => st.slug === slug).map(([id]) => id);
    if (!ids.length) throw Object.assign(new Error("no run is active for this project"), { status: 409 });
    await Promise.all(ids.map((id) => stop(id, "paused_by_human")));
    return { stopping: ids };
  }

  /** Ends a run exactly once: transcript, container removal, token revocation, usage, run record, interview status. */
  async function finish(id, forced, detail, exitCode) {
    const st = active.get(id);
    if (!st || st.finished) return;
    st.finished = true;
    clearInterval(st.poll);
    for (const t of Object.values(st.timers)) clearTimeout(t);
    try { rmSync(tokenFile(st.token), { force: true }); } catch { /* gone */ }
    let transcript = "";
    if (st.containerId) {
      try { transcript = (await docker.logs(st.containerId)).stdout; } catch (e) { log({ action: "logs_failed", run: id, error: e.message }); }
      await docker.remove(st.containerId).catch((e) => log({ action: "remove_failed", run: id, error: e.message }));
    }
    writeAtomic(`${dirs.data}/runs/${id}/transcript.jsonl`, transcript);
    const events = transcript.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const init = events.find((e) => e.type === "system" && e.subtype === "init");
    const result = [...events].reverse().find((e) => e.type === "result");
    await lock(st.slug, async () => {
      const iv = interview.load(st.slug);
      let reason = forced ?? st.stopReason;
      if (!reason) {
        if (iv.status === "finished") reason = "finished";
        else if (result?.subtype === "error_max_turns") reason = "turn_cap";
        else if (result?.is_error) reason = "model_error";
        else if (exitCode !== 0) reason = "failed";
        else reason = "ended_without_finish";
      }
      const rec = readJson(runPath(id));
      rec.ended_at = new Date().toISOString();
      rec.exit_reason = reason;
      if (detail || (result?.is_error && result.result)) rec.exit_detail = String(detail ?? result.result).slice(0, 500);
      rec.exit_code = exitCode ?? null;
      rec.tools_offered = init?.tools ?? null;
      rec.usage = summarize(readUsage(`${dirs.usage}/${id}.jsonl`), prices);
      writeJson(runPath(id), rec);
      const entry = iv.log.runs.find((r) => r.run_id === id);
      if (entry) Object.assign(entry, { ended_at: rec.ended_at, end_reason: reason === "finished" ? "finished" : reason.startsWith("paused") || reason === "ended_without_finish" || reason === "idle_timeout" ? "paused" : "failed" });
      if (iv.active_run === id) {
        iv.active_run = null;
        if (iv.status !== "finished") iv.status = "paused";
        if (iv.status === "paused" && iv.log.status !== "outdated") iv.log.status = "paused";
        iv.last_exit_reason = reason;
      }
      interview.save(st.slug, iv);
      log({ action: "run_ended", run: id, reason, tool_calls: rec.tool_calls, usage: rec.usage });
    });
    rmSync(st.base, { recursive: true, force: true });
    active.delete(id);
  }

  /** After a factory restart: remove leftover run containers, revoke all tokens, mark open runs as ended. */
  async function recover(slugs) {
    for (const c of await docker.list([LABEL, `dev.levuvo-sf.project=${composeProject}`]).catch(() => [])) await docker.remove(c.Id).catch(() => {});
    for (const f of readdirSync(dirs.tokens)) rmSync(`${dirs.tokens}/${f}`, { force: true });
    for (const d of readdirSync(dirs.runs)) rmSync(`${dirs.runs}/${d}`, { recursive: true, force: true });
    for (const slug of slugs) {
      const iv = interview.load(slug);
      if (!iv.active_run) continue;
      const rec = readJson(runPath(iv.active_run), null);
      if (rec && !rec.ended_at) writeJson(runPath(iv.active_run), { ...rec, ended_at: new Date().toISOString(), exit_reason: "factory_restarted" });
      const entry = iv.log.runs.find((r) => r.run_id === iv.active_run);
      if (entry && !entry.ended_at) Object.assign(entry, { ended_at: new Date().toISOString(), end_reason: "paused" });
      iv.active_run = null;
      if (iv.status !== "finished") iv.status = "paused";
      iv.last_exit_reason = "factory_restarted";
      interview.save(slug, iv);
    }
  }

  const runRecord = (id) => readJson(runPath(id), null);
  const isActive = (slug) => [...active.values()].some((st) => st.slug === slug);
  return { start, answer, pause, stop, recover, runRecord, isActive, active };
}
