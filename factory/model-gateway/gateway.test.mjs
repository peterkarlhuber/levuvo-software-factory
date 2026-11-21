import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allowedPath, checkRequest, clientToken, REFUSED, createGateway, runForToken, storeKey, upstream, upstreamHeaders, UsageMeter } from "./gateway.mjs";

const TOKEN = "a".repeat(64);
const sha = (s) => createHash("sha256").update(s).digest("hex");

function setup({ key = "sk-ant-test-key-0123456789abcdef", expires = Date.now() + 60_000, serverTools } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gw-"));
  const tokens = join(dir, "tokens"), usage = join(dir, "usage"), keyFile = join(dir, "api-key");
  for (const d of [tokens, usage]) mkdirSync(d, { recursive: true });
  writeFileSync(join(tokens, sha(TOKEN)), JSON.stringify({ run_id: "run-1", expires_at: new Date(expires).toISOString(), ...(serverTools ? { server_tools: serverTools } : {}) }));
  if (key) writeFileSync(keyFile, key);
  return { dir, tokens, usage, keyFile };
}

/** A fake model API that records what it received and answers with `reply`. */
async function fakeUpstream(reply) {
  const seen = [];
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c)).on("end", () => { seen.push({ url: req.url, headers: req.headers, body: b }); reply(req, res); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, seen, target: { protocol: "http:", host: "127.0.0.1", port: srv.address().port } };
}

async function call(gw, { method = "POST", path = "/v1/messages?beta=true", headers = {}, body = "{}" } = {}) {
  await new Promise((r) => gw.listening ? r() : gw.listen(0, "127.0.0.1", r));
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: gw.address().port, method, path, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)).on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const SSE = [
  ["message_start", { message: { model: "claude-opus-5-5", usage: { input_tokens: 120, output_tokens: 1, cache_creation_input_tokens: 30, cache_read_input_tokens: 400 } } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "hi" } }],
  ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } }],
  ["message_stop", {}],
].map(([t, d]) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`).join("");

test("only the exact model paths are allowed", () => {
  for (const ok of ["/v1/messages", "/v1/messages?beta=true", "/v1/messages/count_tokens?beta=true"]) assert.ok(allowedPath(ok), ok);
  for (const bad of ["/v1/models", "/v1/messages/batches", "/v1/messages?x=1", "/v1/messages/../models", "/v1/files", "//v1/messages"]) assert.ok(!allowedPath(bad), bad);
});

test("tokens: format, registration and expiry are checked", () => {
  const { tokens } = setup();
  assert.deepEqual(runForToken(TOKEN, tokens), { runId: "run-1", serverTools: [] });
  assert.equal(runForToken("b".repeat(64), tokens), null);
  assert.equal(runForToken("../../etc/passwd", tokens), null);
  assert.equal(runForToken(TOKEN, tokens, Date.now() + 120_000), null, "expired");
  assert.equal(clientToken({ "x-api-key": ` ${TOKEN} ` }), TOKEN);
  assert.equal(clientToken({ authorization: `Bearer ${TOKEN}` }), TOKEN);
  assert.equal(clientToken({}), null);
});

test("client credentials and other headers never reach the upstream", () => {
  const h = upstreamHeaders({ "x-api-key": TOKEN, authorization: "Bearer x", cookie: "c=1", "anthropic-version": "2023-06-01", "content-type": "application/json", "x-claude-remote-session-id": "s" }, "sk-real", 10);
  assert.deepEqual(h, { "anthropic-version": "2023-06-01", "content-type": "application/json", "x-api-key": "sk-real", "content-length": "10" });
});

test("the upstream is fixed unless the test switch file exists", () => {
  assert.deepEqual(upstream({ LEVUVO_SF_TEST_UPSTREAM: "http://fake:9000" }, false), { protocol: "https:", host: "api.anthropic.com", port: 443 });
  assert.deepEqual(upstream({ LEVUVO_SF_TEST_UPSTREAM: "http://fake:9000" }, true), { protocol: "http:", host: "fake", port: 9000 });
  assert.deepEqual(upstream({}, true), { protocol: "https:", host: "api.anthropic.com", port: 443 });
});

test("usage meter: streaming with cache tokens, JSON, and incomplete streams", () => {
  const m = new UsageMeter("text/event-stream; charset=utf-8");
  for (let i = 0; i < SSE.length; i += 7) m.push(Buffer.from(SSE.slice(i, i + 7))); // arbitrary chunking
  assert.deepEqual(m.end(), { model: "claude-opus-5-5", complete: true, input_tokens: 120, output_tokens: 42, cache_creation_input_tokens: 30, cache_read_input_tokens: 400 });
  const cut = new UsageMeter("text/event-stream");
  cut.push(Buffer.from(SSE.split("event: message_stop")[0]));
  assert.equal(cut.end().complete, false, "no message_stop: incomplete, never counted as final");
  const j = new UsageMeter("application/json");
  j.push(Buffer.from(JSON.stringify({ model: "m", usage: { input_tokens: 5, output_tokens: 6 } })));
  assert.deepEqual(j.end(), { model: "m", complete: true, input_tokens: 5, output_tokens: 6 });
  const bad = new UsageMeter("application/json");
  bad.push(Buffer.from("<html>"));
  assert.equal(bad.end().complete, false);
  // branch review finding 7: an ended stream or JSON reply without token counts is unknown, never zero
  const noUsage = new UsageMeter("text/event-stream");
  noUsage.push(Buffer.from('event: message_start\ndata: {"type":"message_start","message":{"model":"m"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'));
  assert.equal(noUsage.end().complete, false);
  const jNoOut = new UsageMeter("application/json");
  jNoOut.push(Buffer.from(JSON.stringify({ model: "m", usage: { input_tokens: 5 } })));
  assert.equal(jNoOut.end().complete, false);
});

test("usage meter: web searches are counted from server_tool_use, never the queries", () => {
  const sse = SSE.replace('"usage":{"output_tokens":42}', '"usage":{"output_tokens":42,"server_tool_use":{"web_search_requests":3}}');
  const m = new UsageMeter("text/event-stream");
  m.push(Buffer.from(sse));
  assert.equal(m.end().web_search_requests, 3);
  const j = new UsageMeter("application/json");
  j.push(Buffer.from(JSON.stringify({ model: "m", usage: { input_tokens: 5, output_tokens: 6, server_tool_use: { web_search_requests: 1 } } })));
  assert.equal(j.end().web_search_requests, 1);
});

test("server-side tools: only the tested web search version, only when the run's token allows it; fail-closed (scope finding 1, branch findings 1, 2, 5)", () => {
  const req = (o) => Buffer.from(JSON.stringify({ model: "m", messages: [], ...o }));
  const client = { name: "mcp__factory__ask_human", input_schema: { type: "object" } };
  const search = { type: "web_search_20250305", name: "web_search", max_uses: 8 };
  assert.equal(checkRequest(req({ tools: [client] }), []), null);
  assert.equal(checkRequest(req({ tools: [{ ...client, type: "custom" }] }), []), null);
  assert.equal(checkRequest(req({}), []), null);
  assert.equal(checkRequest(req({ tools: [client, search] }), ["web_search"]), null);
  assert.equal(checkRequest(req({ tools: [{ ...search, allowed_callers: ["direct"] }] }), ["web_search"]), null);
  assert.equal(checkRequest(req({ tools: [search] }), []), REFUSED.server, "search off");
  for (const type of ["web_search_20260209", "web_search_20991231", "web_fetch_20250910", "web_fetch_20260209", "code_execution_20250825", "bash_20250124", "text_editor_20250728", "computer_20250124", "memory_20250818", "web_search", null, 5, {}, ["web_search_20250305"]]) {
    assert.equal(checkRequest(req({ tools: [client, { type, name: "t" }] }), ["web_search"]), REFUSED.server, JSON.stringify(type));
  }
  for (const callers of [["code_execution_20250825"], ["direct", "code_execution_20250825"], [], "direct", null]) {
    assert.equal(checkRequest(req({ tools: [{ ...search, allowed_callers: callers }] }), ["web_search"]), REFUSED.server, JSON.stringify(callers));
  }
  for (const bad of [null, "WebSearch", 5, [], { type: "web_search_20250305" }, { name: 5 }]) {
    assert.equal(checkRequest(req({ tools: [client, bad] }), ["web_search"]), REFUSED.tools, JSON.stringify(bad));
  }
  assert.equal(checkRequest(req({ tools: {} }), ["web_search"]), REFUSED.tools);
  assert.equal(checkRequest(req({ mcp_servers: [{ type: "url", url: "https://example.com" }] }), ["web_search"]), REFUSED.field);
  assert.equal(checkRequest(req({ container: null }), ["web_search"]), REFUSED.field);
  for (const b of ["not json", "[]", "null", "5"]) assert.equal(checkRequest(Buffer.from(b), ["web_search"]), REFUSED.json, b);
  assert.ok(Object.values(REFUSED).every((r) => !/web_search|fetch|20250305/.test(r)), "no request content in a reason");
});

test("a refused tool never reaches the API and bills nothing; a token cannot grant unknown tools", async () => {
  const f = await fakeUpstream((req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(SSE); });
  const s = setup({ serverTools: ["web_fetch", "code_execution", "constructor", "__proto__"] });
  assert.deepEqual(runForToken(TOKEN, s.tokens).serverTools, [], "only known names count");
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  const body = JSON.stringify({ model: "m", messages: [], tools: [{ type: "web_fetch_20250910", name: "web_fetch" }] });
  const r = await call(gw, { headers: { "x-api-key": TOKEN }, body });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error.message, `refused by the factory gateway: ${REFUSED.server}`);
  const r2 = await call(gw, { path: "/v1/messages/count_tokens?beta=true", headers: { "x-api-key": TOKEN }, body: JSON.stringify({ tools: [{ type: "web_search_20250305", name: "web_search" }] }) });
  assert.equal(r2.status, 403, "count_tokens is checked too");
  assert.equal(f.seen.length, 0);
  const lines = readFileSync(join(s.usage, "run-1.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].error, "tool_refused");
  gw.close(); f.srv.close();
});

test("web search passes when allowed and its count is recorded", async () => {
  const sse = SSE.replace('"usage":{"output_tokens":42}', '"usage":{"output_tokens":42,"server_tool_use":{"web_search_requests":2}}');
  const f = await fakeUpstream((req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(sse); });
  const s = setup({ serverTools: ["web_search"] });
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  const r = await call(gw, { headers: { "x-api-key": TOKEN }, body: JSON.stringify({ model: "m", messages: [], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }] }) });
  assert.equal(r.status, 200);
  assert.equal(f.seen.length, 1);
  const line = JSON.parse(readFileSync(join(s.usage, "run-1.jsonl"), "utf8").trim());
  assert.equal(line.web_search_requests, 2);
  assert.ok(!JSON.stringify(line).includes("query"));
  gw.close(); f.srv.close();
});

test("forwards with the real key, streams back and records usage", async () => {
  const f = await fakeUpstream((req, res) => { res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "x=1" }); res.end(SSE); });
  const s = setup();
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  const r = await call(gw, { headers: { "x-api-key": TOKEN, "anthropic-version": "2023-06-01", cookie: "secret=1" } });
  assert.equal(r.status, 200);
  assert.equal(r.body, SSE);
  assert.equal(r.headers["set-cookie"], undefined);
  assert.equal(f.seen[0].headers["x-api-key"], "sk-ant-test-key-0123456789abcdef");
  assert.equal(f.seen[0].headers.cookie, undefined);
  assert.equal(f.seen[0].url, "/v1/messages?beta=true");
  const lines = readFileSync(join(s.usage, "run-1.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].output_tokens, 42);
  assert.equal(lines[0].cache_read_input_tokens, 400);
  assert.equal(lines[0].complete, true);
  gw.close(); f.srv.close();
});

test("refuses: wrong method, path, missing or unknown token; no key; redirects", async () => {
  const f = await fakeUpstream((req, res) => { res.writeHead(302, { location: "https://evil.example/" }); res.end(); });
  const s = setup();
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  assert.equal((await call(gw, { method: "GET", headers: { "x-api-key": TOKEN } })).status, 405);
  assert.equal((await call(gw, { path: "/v1/models", headers: { "x-api-key": TOKEN } })).status, 404);
  assert.equal((await call(gw, {})).status, 401);
  assert.equal((await call(gw, { headers: { "x-api-key": "c".repeat(64) } })).status, 401);
  assert.equal(f.seen.length, 0, "nothing refused reaches the upstream");
  const r = await call(gw, { headers: { "x-api-key": TOKEN } });
  assert.equal(r.status, 502, "redirect refused");
  assert.match(readFileSync(join(s.usage, "run-1.jsonl"), "utf8"), /redirect_refused/);
  gw.close(); f.srv.close();
  const s2 = setup({ key: "" });
  const gw2 = createGateway({ tokenDir: s2.tokens, usageDir: s2.usage, keyFile: s2.keyFile, target: f.target });
  const nokey = await call(gw2, { headers: { "x-api-key": TOKEN } });
  assert.equal(nokey.status, 503);
  assert.match(nokey.body, /set-api-key/);
  gw2.close();
});

test("an upstream error response is passed on and recorded as billed nothing", async () => {
  const f = await fakeUpstream((req, res) => { res.writeHead(429, { "content-type": "application/json", "retry-after": "3" }); res.end('{"type":"error"}'); });
  const s = setup();
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  const r = await call(gw, { headers: { "x-api-key": TOKEN } });
  assert.equal(r.status, 429);
  assert.equal(r.headers["retry-after"], "3");
  assert.deepEqual(JSON.parse(readFileSync(join(s.usage, "run-1.jsonl"), "utf8")).status, 429);
  gw.close(); f.srv.close();
});

test("a failure after the request was sent counts as unknown usage; an unreachable API as nothing billed (re-check finding 2)", async () => {
  const f = await fakeUpstream((req) => { req.socket.destroy(); }); // takes the request, then drops the connection
  const s = setup();
  const gw = createGateway({ tokenDir: s.tokens, usageDir: s.usage, keyFile: s.keyFile, target: f.target });
  assert.equal((await call(gw, { headers: { "x-api-key": TOKEN } })).status, 502);
  const sent = JSON.parse(readFileSync(join(s.usage, "run-1.jsonl"), "utf8"));
  assert.equal(sent.complete, false);
  assert.equal(sent.error, undefined, "not counted as a free error");
  gw.close(); f.srv.close();
  const s2 = setup();
  const gw2 = createGateway({ tokenDir: s2.tokens, usageDir: s2.usage, keyFile: s2.keyFile, target: { protocol: "http:", host: "127.0.0.1", port: 1 } });
  assert.equal((await call(gw2, { headers: { "x-api-key": TOKEN } })).status, 502);
  const never = JSON.parse(readFileSync(join(s2.usage, "run-1.jsonl"), "utf8"));
  assert.deepEqual([never.error, never.complete], ["upstream_unreachable", true]);
  gw2.close();
});

test("set-key: checks the shape and stores the key privately", () => {
  const dir = mkdtempSync(join(tmpdir(), "key-"));
  const file = join(dir, "k", "api-key");
  assert.throws(() => storeKey("hello", file), /does not look like/);
  assert.ok(!existsSync(file));
  storeKey("  sk-ant-api03-abcdefghijklmnopqrstuvwxyz \n", file);
  assert.equal(readFileSync(file, "utf8"), "sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
