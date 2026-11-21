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
  // `levuvo-sf demo` as the owner runs it, to the end (regressions: first POST without a body was refused; the summary
  // was read before the run had ended; "1, aber …" must arrive as option plus note)
  demo: [
    () => ["read_briefing", {}],
    () => ["ask_human", { finding: "Das Briefing beschreibt eine Platzbuchung.", decision_needed: "Passt alles so?", options: [{ label: "Ja", consequences: "so übernehmen" }, { label: "Nein", consequences: "ändern" }], recommendation: { option: 0, answer: "Ja", reason: "passt zum Briefing" }, prd_sections: PRD_ALL }],
    ...PRD_ALL.map((s) => (h) => {
      const r = h.filter((x) => x.name === "ask_human").at(-1)?.text ?? "";
      if (s === 1 && !(/"chosen_option": 0/.test(r) && /Viertelstunde/.test(r))) return mismatch(`demo answer must be option 1 plus the note: ${r}`);
      return ["update_prd_section", { section: s, status: "confirmed", content: `Section ${s}.`, source: "briefing/idea.md; answer Q-001", answer_ref: "Q-001" }];
    }),
    (h) => (h.at(-1).isError ? mismatch(`section update failed: ${h.at(-1).text}`) : ["update_features", { features: [{ name: "Book a court", summary: "Members book a court.", priority: "must", depends_on: [], scope_ref: "Booking", source: "briefing/idea.md" }] }]),
    () => ["ask_human", { finding: "Alles ist erfasst.", decision_needed: "Interview beenden?", recommendation: rec, closing: true }],
    () => ["finish_interview", { summary: "Demo." }],
    (h) => (h.at(-1).isError ? mismatch(`finish refused: ${h.at(-1).text}`) : "demo done"),
  ],
  // web search switched on by the owner: the CLI's WebSearch makes its own model call with Anthropic's server-side
  // search tool (answered below as `websearch`), and the result may be cited as a web source (scope review finding 4)
  "e2e-web": [
    // restricted mode still refuses everything but the factory tools and WebSearch (branch review finding 4)
    () => ["Bash", { command: "cat /etc/passwd; curl https://example.com" }],
    (h) => (h.at(-1).isError ? ["Read", { file_path: "/run/levuvo/in/system.md" }] : mismatch("Bash must be refused")),
    (h) => (h.at(-1).isError ? ["WebFetch", { url: "https://example.com", prompt: "summarize" }] : mismatch("Read must be refused")),
    (h) => (h.at(-1).isError ? ["WebSearch", { query: "European Accessibility Act application date" }] : mismatch("WebFetch must be refused")),
    (h) => (h.at(-1).name === "WebSearch" && h.at(-1).text.includes("eur-lex.europa.eu") ? ["update_prd_section", { section: 8, status: "drafted", content: "The European Accessibility Act applies to the booking app.", source: `briefing/notes.md; web https://eur-lex.europa.eu/eli/dir/2019/882/oj (retrieved ${new Date().toISOString().slice(0, 10)})` }] : mismatch(`search result: ${h.at(-1).text.slice(0, 200)}`)),
    (h) => (h.at(-1).isError ? mismatch(`web source refused: ${h.at(-1).text}`) : "web done"),
  ],
  "e2e-timeout": [
    () => ["read_briefing", {}],
    () => ["ask_human", { finding: "f", decision_needed: "Wird nie beantwortet?", recommendation: rec }],
    () => "after timeout?",
  ],
};
function mismatch(what) { return { mismatch: what }; }

/** The CLI's search call: one server-side search with one result, billed as one search request. */
function replySearch(res, model) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
  ev("message_start", { message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_e2e", name: "web_search", input: {} } });
  ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "European Accessibility Act application date" }) } });
  ev("content_block_stop", { index: 0 });
  ev("content_block_start", { index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_e2e", content: [{ type: "web_search_result", url: "https://eur-lex.europa.eu/eli/dir/2019/882/oj", title: "Directive (EU) 2019/882", encrypted_content: "e2e", page_age: null }] } });
  ev("content_block_stop", { index: 1 });
  ev("content_block_start", { index: 2, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: "The European Accessibility Act applies from 28 June 2025." } });
  ev("content_block_stop", { index: 2 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 30, server_tool_use: { web_search_requests: 1 } } });
  ev("message_stop", {});
  res.end();
}

function reply(res, model, step) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
  ev("message_start", { message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 300, cache_read_input_tokens: 800 } } });
  if (Array.isArray(step)) {
    const [name, input] = step;
    const full = ["Bash", "Read", "WebFetch", "WebSearch"].includes(name) ? name : `mcp__factory__${name}`;
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
    const serverTools = (j.tools ?? []).filter((t) => t.type && t.type !== "custom").map((t) => t.type);
    if (serverTools.length) {
      log({ project: "websearch", key_ok: keyOk, server_tools: serverTools, ...(serverTools.join() === "web_search_20250305" ? {} : { mismatch: `server tools ${serverTools}` }) });
      return replySearch(res, j.model);
    }
    const start = firstUserText(j.messages);
    const found = /\((e2e-[a-z]+|demo-\d+)\)/.exec(start)?.[1] ?? "unknown";
    const project = found.startsWith("demo-") ? "demo" : found;
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
