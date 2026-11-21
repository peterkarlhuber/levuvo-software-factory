#!/usr/bin/env node
// Levuvo SF model gateway: the model path in API billing mode (PLAYBOOK G7.4, G12.1).
// Agent runs on the internal network `agents-api` reach nothing but this gateway. A run gets a random per-run token
// instead of an API key; the gateway accepts only tokens the factory registered for a live run, takes only
// `POST /v1/messages` (and `count_tokens`), drops every client credential, adds the real API key, forwards over HTTPS
// with certificate check to the fixed upstream api.anthropic.com, follows no redirects and records the token usage of
// every model call per run. It is the only container that can read the key.
// Server-side tools run at Anthropic, not in the container, so network isolation does not limit them: the gateway
// reads every request and refuses any server-side tool the run's token does not allow (only `web_search_20250305`, only for a
// run whose profile has web search on), and any request that names remote MCP servers or a code container.
//
// Files (all paths fixed):
//   /run/levuvo/key/api-key        the real key, read on every request (a new key applies at once); volume, read-only here
//   /run/levuvo/tokens/<sha256>    one file per live run token, written and removed by the factory; read-only here.
//                                  JSON: { run_id, expires_at, server_tools: [] | ["web_search"] }
//   /var/lib/levuvo/usage/<run>.jsonl  one line per model call: model, status, tokens or `complete: false`
// `node gateway.mjs set-key` stores a key read from standard input (see compose service `set-api-key`).
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";

export const KEY_FILE = "/run/levuvo/key/api-key";
export const TOKEN_DIR = "/run/levuvo/tokens";
export const USAGE_DIR = "/var/lib/levuvo/usage";
export const MAX_BODY = 32 * 1024 * 1024; // the API's own request limit
const UPSTREAM = { protocol: "https:", host: "api.anthropic.com", port: 443 };
// Only the test image (build target `testable`) contains this file; only then may LEVUVO_SF_TEST_UPSTREAM redirect the
// gateway to a fake model API. The production image has no switch.
const TEST_SWITCH = "/opt/levuvo/ALLOW_TEST_UPSTREAM";

/** Request headers passed upstream; everything else (credentials, cookies, client ids) is dropped. */
const PASS_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta", "user-agent", "x-stainless-retry-count", "x-stainless-timeout"];
const PATHS = new Set(["/v1/messages", "/v1/messages/count_tokens"]);

export function upstream(env = process.env, switchExists = exists(TEST_SWITCH)) {
  if (switchExists && env.LEVUVO_SF_TEST_UPSTREAM) {
    const u = new URL(env.LEVUVO_SF_TEST_UPSTREAM);
    return { protocol: u.protocol, host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) };
  }
  return UPSTREAM;
}

function exists(p) { try { statSync(p); return true; } catch { return false; } }
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The run a token belongs to and the server-side tools it may use, or null. Token: 64 hex characters, registered by
 * the factory, not expired. A missing or unknown `server_tools` entry allows nothing. */
export function runForToken(token, dir = TOKEN_DIR, now = Date.now()) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  try {
    const t = JSON.parse(readFileSync(`${dir}/${sha256(token)}`, "utf8"));
    if (!/^[a-z0-9-]{3,64}$/.test(t.run_id) || !(Date.parse(t.expires_at) > now)) return null;
    const serverTools = Array.isArray(t.server_tools) ? t.server_tools.filter((x) => Object.hasOwn(SERVER_TOOLS, x)) : [];
    return { runId: t.run_id, serverTools };
  } catch { return null; }
}

/**
 * Server-side tools a run profile can allow, each as an exact check of the tool definition. Only the version tested
 * with the pinned CLI passes: later web search versions can run code at Anthropic for filtering, so a new version is
 * refused until it is tested and added here (branch review finding 1). Programmatic callers are refused too.
 */
const SERVER_TOOLS = {
  web_search: (t) => t.type === "web_search_20250305"
    && (t.allowed_callers === undefined || (Array.isArray(t.allowed_callers) && t.allowed_callers.length === 1 && t.allowed_callers[0] === "direct")),
};
/** Request fields that make Anthropic reach out on the run's behalf; never allowed. */
const FORBIDDEN_FIELDS = ["mcp_servers", "container"];
/** Fixed refusal reasons: nothing from the request is echoed into logs or answers (branch review finding 5). */
export const REFUSED = { json: "request is not a JSON object", field: "remote tools or containers are not allowed", tools: "invalid tool list", server: "unauthorized server tool" };

/**
 * Checks the tools a request offers against the run's allowed server-side tools; fail-closed. A client tool (an object
 * with a string `name` and no `type` or `custom`) runs in the CLI inside the isolated container. Every other entry is
 * refused unless it is exactly an allowed server-side tool. Returns null when allowed, else one of REFUSED.
 */
export function checkRequest(body, serverTools) {
  let j;
  try { j = JSON.parse(body.toString("utf8")); } catch { return REFUSED.json; }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return REFUSED.json;
  for (const f of FORBIDDEN_FIELDS) if (Object.hasOwn(j, f)) return REFUSED.field;
  if (!Object.hasOwn(j, "tools")) return null;
  if (!Array.isArray(j.tools)) return REFUSED.tools;
  for (const t of j.tools) {
    if (typeof t !== "object" || t === null || Array.isArray(t) || typeof t.name !== "string") return REFUSED.tools;
    if (!Object.hasOwn(t, "type") || t.type === "custom") continue;
    if (!serverTools.some((name) => SERVER_TOOLS[name](t))) return REFUSED.server;
  }
  return null;
}

/** Path check: exact path, the only query the CLI sends is `beta=true`. */
export function allowedPath(url) {
  const [path, query = ""] = String(url).split("?", 2);
  return PATHS.has(path) && (query === "" || query === "beta=true");
}

/** Client token from `x-api-key` or `Authorization: Bearer`. */
export function clientToken(headers) {
  if (typeof headers["x-api-key"] === "string") return headers["x-api-key"].trim();
  const m = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? "");
  return m ? m[1] : null;
}

export function upstreamHeaders(headers, key, length) {
  const out = {};
  for (const h of PASS_HEADERS) if (typeof headers[h] === "string") out[h] = headers[h];
  out["x-api-key"] = key;
  out["content-length"] = String(length);
  return out;
}

/**
 * Collects the usage of one model response. Streaming: input and cache tokens from `message_start`, the final output
 * count from the last `message_delta`; complete only once `message_stop` was seen. JSON: the `usage` object.
 * Anything else stays incomplete, which the factory reports as unknown, never as zero.
 */
export class UsageMeter {
  constructor(contentType) {
    this.sse = /text\/event-stream/.test(contentType ?? "");
    this.buf = "";
    this.usage = {};
    this.model = null;
    this.complete = false;
  }
  push(chunk) {
    this.buf += chunk.toString("utf8");
    if (!this.sse) return;
    let i;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (data) this.event(data);
    }
    if (this.buf.length > 1024 * 1024) this.buf = ""; // one event never gets this big; do not grow without bound
  }
  event(data) {
    let e;
    try { e = JSON.parse(data); } catch { return; }
    if (e.type === "message_start") { this.model = e.message?.model ?? null; Object.assign(this.usage, pickUsage(e.message?.usage)); }
    else if (e.type === "message_delta") Object.assign(this.usage, pickUsage(e.usage));
    else if (e.type === "message_stop") this.stopped = true;
  }
  end() {
    if (!this.sse) {
      try {
        const j = JSON.parse(this.buf);
        this.model = j.model ?? null;
        if (j.usage) { this.usage = pickUsage(j.usage); this.complete = true; }
      } catch { /* not JSON: incomplete */ }
    }
    // complete only with the end of the message AND the token counts that bill it (branch review finding 7)
    if (this.sse) this.complete = this.stopped === true && Number.isInteger(this.usage.input_tokens) && Number.isInteger(this.usage.output_tokens);
    else this.complete = this.complete && Number.isInteger(this.usage.input_tokens) && Number.isInteger(this.usage.output_tokens);
    return { model: this.model, complete: this.complete, ...this.usage };
  }
}

const USAGE_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
function pickUsage(u) {
  const out = {};
  for (const f of USAGE_FIELDS) if (Number.isInteger(u?.[f]) && u[f] >= 0) out[f] = u[f];
  // searches are billed per request (G12.1); the count only, never the queries (G11.2)
  const ws = u?.server_tool_use?.web_search_requests;
  if (Number.isInteger(ws) && ws >= 0) out.web_search_requests = ws;
  return out;
}

function log(o) { process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...o }) + "\n"); }

export function createGateway({ tokenDir = TOKEN_DIR, usageDir = USAGE_DIR, keyFile = KEY_FILE, target = upstream() } = {}) {
  const record = (runId, entry) => {
    try { appendFileSync(`${usageDir}/${runId}.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n"); }
    catch (e) { log({ action: "usage_write_failed", run: runId, error: e.code }); }
  };
  const fail = (res, status, type, message) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type, message } }));
  };
  return createServer((req, res) => {
    if (req.method !== "POST") return fail(res, 405, "invalid_request_error", "only POST is accepted");
    if (!allowedPath(req.url)) { log({ action: "blocked", reason: "path", path: String(req.url).slice(0, 100) }); return fail(res, 404, "not_found_error", "not available through the factory gateway"); }
    const run = runForToken(clientToken(req.headers), tokenDir);
    if (!run) { log({ action: "blocked", reason: "token" }); return fail(res, 401, "authentication_error", "unknown or expired run token"); }
    const runId = run.runId;
    let key;
    try { key = readFileSync(keyFile, "utf8").trim(); } catch { key = ""; }
    if (!key) { record(runId, { error: "no_api_key", complete: true }); return fail(res, 503, "api_error", "no API key stored in the factory; run: docker compose run --rm set-api-key"); }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { fail(res, 413, "request_too_large", "request too large"); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return;
      const body = Buffer.concat(chunks);
      const refused = checkRequest(body, run.serverTools);
      if (refused) {
        log({ action: "blocked", reason: "tools", run: runId, detail: refused });
        record(runId, { error: "tool_refused", detail: refused, complete: true }); // refused here: nothing billed
        return fail(res, 403, "permission_error", `refused by the factory gateway: ${refused}`);
      }
      const counting = req.url.startsWith("/v1/messages/count_tokens");
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      const up = send({
        host: target.host, port: target.port, servername: target.host, method: "POST", path: req.url,
        headers: upstreamHeaders(req.headers, key, body.length), timeout: 15 * 60 * 1000,
      }, (ur) => {
        const status = ur.statusCode ?? 502;
        if (status >= 300 && status < 400) { // never follow or pass on a redirect
          ur.resume();
          record(runId, { status, error: "redirect_refused", complete: true });
          return fail(res, 502, "api_error", "upstream redirect refused");
        }
        const meter = new UsageMeter(ur.headers["content-type"]);
        const headers = {};
        for (const h of ["content-type", "request-id", "retry-after", "x-should-retry"]) if (ur.headers[h]) headers[h] = ur.headers[h];
        res.writeHead(status, headers);
        ur.on("data", (c) => { if (status === 200 && !counting) meter.push(c); res.write(c); });
        ur.on("end", () => {
          res.end();
          if (counting) return;
          if (status === 200) record(runId, { status, ...meter.end() });
          else record(runId, { status, complete: true }); // an error response bills nothing
          log({ action: "forwarded", run: runId, status });
        });
        ur.on("error", () => { if (!counting) record(runId, { status, ...meter.end(), complete: false }); res.destroy(); });
      });
      up.on("timeout", () => up.destroy(new Error("timeout")));
      let sent = false; // the request reached the API's connection: from then on a failure may still be billed
      up.on("error", (e) => {
        log({ action: "upstream_error", run: runId, error: e.code ?? e.message, sent });
        // never connected: nothing billed; failed after sending: unknown usage, never zero (G12.1, re-check finding 2)
        if (!counting) record(runId, sent ? { transport_error: e.code ?? "error", complete: false } : { error: "upstream_unreachable", complete: true });
        fail(res, 502, "api_error", "model API not reachable");
      });
      // a client that goes away mid-stream: the response is incomplete and recorded that way by `ur` errors / end
      res.on("close", () => { if (!res.writableEnded) up.destroy(); });
      up.end(body, () => { sent = true; });
    });
  });
}

/** `set-key`: reads the key from standard input, checks its shape and stores it with mode 0600 (atomic replace). */
export function storeKey(input, keyFile = KEY_FILE) {
  const key = String(input).trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Error("this does not look like an Anthropic API key (sk-ant-…)");
  mkdirSync(keyFile.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(`${keyFile}.new`, key, { mode: 0o600 });
  renameSync(`${keyFile}.new`, keyFile);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "set-key") {
    let s = "";
    if (process.stdin.isTTY) process.stderr.write("Paste the Anthropic API key (input is hidden), then press Enter: ");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("data", (c) => {
      for (const ch of c.toString("utf8")) {
        if (ch === "\u0003") { process.stderr.write("\ncancelled\n"); process.exit(130); }
        if (ch === "\r" || ch === "\n") { finish(); return; }
        if (ch === "\u007f") s = s.slice(0, -1); else s += ch;
      }
    });
    process.stdin.on("end", finish);
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      try { storeKey(s); process.stderr.write("\nAPI key stored. It applies to the next model call; no restart needed.\n"); process.exit(0); }
      catch (e) { process.stderr.write(`\nNot stored: ${e.message}\n`); process.exit(1); }
    }
  } else {
    const t = upstream();
    createGateway({ target: t }).listen(8080, "0.0.0.0", () => log({ action: "listening", port: 8080, upstream: `${t.protocol}//${t.host}:${t.port}` }));
  }
}
