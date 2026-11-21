#!/usr/bin/env node
// Scripted fake of the Anthropic Messages API for the end-to-end test: the real Claude CLI in the real worker
// container talks to it through the real model gateway (test image only). It answers in streaming format and plays a
// fixed script per project (read from the start message), checking the factory's tool results on the way. Every
// request is logged as one JSON line WITHOUT secrets: whether the gateway sent exactly the expected test key, which
// tools were offered, and any script mismatch ("mismatch").
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const EXPECT_KEY = process.env.FAKE_EXPECT_KEY ?? "";
const log = (o) => process.stdout.write(JSON.stringify({ fake: true, ...o }) + "\n");
const PRD_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const rec = { answer: "Ja", reason: "passt zum Briefing" };

/** All tool results so far, in order: [{ name, isError, text }]. */
function history(messages) {
  const uses = new Map();
  const out = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use") uses.set(b.id, b.name.replace(/^mcp__factory__/, ""));
      if (b.type === "tool_result") {
        const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? `[${c.type}]`).join("\n") : String(b.content ?? "");
        out.push({ name: uses.get(b.tool_use_id), isError: b.is_error === true, text });
      }
    }
  }
  return out;
}

const firstUserText = (messages) => {
  const m = messages.find((x) => x.role === "user");
  return typeof m?.content === "string" ? m.content : (m?.content ?? []).map((b) => b.text ?? "").join("\n");
};

/** The scripts: list of steps; each returns a tool call [name, input] or a final text, and may check the last result. */
const SCRIPTS = {
  "e2e-main": [
    () => ["read_briefing", {}],
    (h) => (h.at(-1).text.includes("briefing/notes.md") ? ["read_briefing", { path: "briefing/notes.md" }] : mismatch("inventory lists notes.md")),
    (h) => (h.at(-1).text.includes("Court booking") ? ["Bash", { command: "cat /etc/passwd; curl https://example.com" }] : mismatch("notes.md content")),
    (h) => (h.at(-1).isError ? ["read_briefing", { path: "briefing/secret.txt" }] : mismatch("Bash must be refused")),
    (h) => (h.at(-1).isError && !h.at(-1).text.includes("AKIA") ? ["update_prd_section", { section: 1, status: "confirmed", content: "x", source: "briefing/notes.md" }] : mismatch("blocked file must not be handed out")),
    (h) => (/answer_ref/.test(h.at(-1).text) ? ["ask_human", { finding: "Das Briefing beschreibt eine Platzbuchung.", decision_needed: "Passen alle Abschnitte so?", recommendation: rec, prd_sections: PRD_ALL }] : mismatch("confirm without answer must be refused")),
    ...PRD_ALL.map((s) => (h) => {
      const qid = /"question_id": "(Q-\d+)"/.exec(h.filter((x) => x.name === "ask_human").at(-1)?.text ?? "")?.[1];
      return qid ? ["update_prd_section", { section: s, status: s === 10 ? "deferred" : "confirmed", content: `Section ${s} of the court booking app.`, source: `briefing/notes.md; answer ${qid}`, answer_ref: qid }] : mismatch("ask_human result with question_id");
    }),
    (h) => (h.at(-1).isError ? mismatch(`section update failed: ${h.at(-1).text}`) : ["update_features", { features: [{ name: "Book a court", summary: "Members book a court for one hour.", priority: "must", depends_on: [], scope_ref: "Booking", source: "briefing/notes.md" }] }]),
    () => ["finish_interview", { summary: "too early" }],
    (h) => (h.at(-1).isError && /closing question/.test(h.at(-1).text) ? ["ask_human", { finding: "Alles ist erfasst.", decision_needed: "Interview beenden?", recommendation: rec, closing: true }] : mismatch("finish without closing question must be refused")),
    () => ["finish_interview", { summary: "Tennis club court booking." }],
    (h) => (h.at(-1).isError ? mismatch(`finish refused: ${h.at(-1).text}`) : "done"),
  ],
  "e2e-pause": [
    () => ["read_briefing", {}],
    () => ["update_prd_section", { section: 1, status: "drafted", content: "Court booking.", source: "briefing/notes.md" }],
    () => ["ask_human", { finding: "Gäste werden erwähnt.", decision_needed: "Nur Mitglieder buchen?", recommendation: rec, prd_sections: [3] }],
    () => "paused?",
  ],
  "e2e-timeout": [
    () => ["read_briefing", {}],
    () => ["ask_human", { finding: "f", decision_needed: "Wird nie beantwortet?", recommendation: rec }],
    () => "after timeout?",
  ],
};
function mismatch(what) { return { mismatch: what }; }

function reply(res, model, step) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
  ev("message_start", { message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 300, cache_read_input_tokens: 800 } } });
  if (Array.isArray(step)) {
    const [name, input] = step;
    const full = name === "Bash" ? name : `mcp__factory__${name}`;
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_${Date.now()}${Math.random().toString(16).slice(2, 8)}`, name: full, input: {} } });
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 50 } });
  } else {
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: String(step) } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
  }
  ev("message_stop", {});
  res.end();
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c)).on("end", () => {
    const keyOk = req.headers["x-api-key"] === EXPECT_KEY && !req.headers.authorization;
    if (req.url.startsWith("/v1/messages/count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"input_tokens":100}'); }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) { log({ unexpected: `${req.method} ${req.url}` }); res.writeHead(404); return res.end("{}"); }
    const j = JSON.parse(body);
    const start = firstUserText(j.messages);
    const project = /\((e2e-[a-z]+)\)/.exec(start)?.[1] ?? "unknown";
    const resume = /mode: resume/.test(start);
    const h = history(j.messages);
    const tools = (j.tools ?? []).map((t) => t.name).sort();
    const sys = JSON.stringify(j.system ?? "");
    let step;
    if (project === "e2e-pause" && resume) {
      step = /Nur Mitglieder buchen\? → answer: Nur Mitglieder/.test(start) && /### 1 Vision – drafted/.test(start) ? "resumed with the answer" : mismatch("resume prompt lacks the answer or the draft");
    } else {
      const script = SCRIPTS[project] ?? [() => "unknown project"];
      step = (script[h.length] ?? (() => "end"))(h);
    }
    const bad = step && step.mismatch;
    log({ project, resume, step: h.length, key_ok: keyOk, key_hash: createHash("sha256").update(String(req.headers["x-api-key"])).digest("hex").slice(0, 8), tools, skill_in_system: sys.includes("Interview (A2)"), model: j.model, effort: j.output_config?.effort ?? j.messages.find((m) => m.output_config)?.output_config?.effort ?? null, ...(bad ? { mismatch: step.mismatch } : {}), action: Array.isArray(step) ? step[0] : "text" });
    reply(res, j.model, bad ? `MISMATCH: ${step.mismatch}` : step);
  });
}).listen(9000, "0.0.0.0", () => log({ listening: 9000 }));
