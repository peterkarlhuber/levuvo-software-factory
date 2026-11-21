import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cliArgs } from "./launch.mjs";
import { createHandler, loadTools, relay } from "./mcp.mjs";

const env = { LEVUVO_SF_MODEL: "claude-opus-5-5", LEVUVO_SF_EFFORT: "medium", LEVUVO_SF_MAX_TURNS: "300" };
function inDir() {
  const d = mkdtempSync(join(tmpdir(), "in-"));
  writeFileSync(join(d, "prompt.md"), "start");
  writeFileSync(join(d, "system.md"), "skill");
  writeFileSync(join(d, "tools.json"), JSON.stringify([{ name: "ask_human", description: "d", inputSchema: { type: "object" } }, { name: "read_briefing", description: "r", inputSchema: { type: "object" } }]));
  return d;
}

test("CLI arguments: no built-in tools, only the named factory tools, nothing asked, skill as system prompt", () => {
  const d = inDir();
  const a = cliArgs(env, ["ask_human", "read_briefing"], d);
  const val = (flag) => a[a.indexOf(flag) + 1];
  assert.ok(a.includes("--bare"));
  assert.equal(val("--tools"), "");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.equal(val("--allowedTools"), "mcp__factory__ask_human,mcp__factory__read_briefing");
  assert.ok(!a.join(" ").includes("*"), "no wildcard");
  assert.equal(val("--permission-mode"), "dontAsk");
  assert.ok(a.includes("--disable-slash-commands"));
  assert.equal(val("--system-prompt-file"), `${d}/system.md`);
  assert.equal(val("-p"), "start");
  assert.equal(val("--model"), "claude-opus-5-5");
  assert.equal(val("--effort"), "medium");
  assert.equal(val("--max-turns"), "300");
  assert.ok(!a.includes("--dangerously-skip-permissions"));
});

test("CLI arguments: invalid model, effort, turn cap or tool names are refused", () => {
  const d = inDir();
  assert.throws(() => cliArgs({ ...env, LEVUVO_SF_MODEL: "gpt; rm -rf /" }, ["ask_human"], d), /model/);
  assert.throws(() => cliArgs({ ...env, LEVUVO_SF_EFFORT: "extreme" }, ["ask_human"], d), /effort/);
  assert.throws(() => cliArgs({ ...env, LEVUVO_SF_MAX_TURNS: "0" }, ["ask_human"], d), /turn/);
  assert.throws(() => cliArgs(env, ["Bash"], d), /tool/);
  assert.throws(() => cliArgs(env, ["*"], d), /tool/);
  assert.throws(() => cliArgs(env, [], d), /tool/);
});

test("MCP: initialize, list, unknown tools refused, notifications ignored", async () => {
  const tools = loadTools(inDir());
  const calls = [];
  const h = createHandler({ tools, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: "text", text: "ok" }], isError: false }; } });
  const init = await h({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal((await h({ jsonrpc: "2.0", method: "notifications/initialized" })), null);
  assert.deepEqual((await h({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools.map((t) => t.name), ["ask_human", "read_briefing"]);
  const bad = await h({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "Bash", arguments: { command: "id" } } });
  assert.equal(bad.result.isError, true);
  assert.equal(calls.length, 0);
  const ok = await h({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ask_human", arguments: { x: 1 } } });
  assert.equal(ok.result.content[0].text, "ok");
  assert.deepEqual(calls, [["ask_human", { x: 1 }]]);
  assert.equal((await h({ jsonrpc: "2.0", id: 5, method: "resources/list" })).error.code, -32601);
});

test("relay: writes one request file and returns the factory's answer", async () => {
  const io = mkdtempSync(join(tmpdir(), "io-"));
  mkdirSync(join(io, "req")); mkdirSync(join(io, "res"));
  const p = relay("ask_human", { q: 1 }, io, async () => {
    const [f] = readdirSync(join(io, "req")).filter((x) => x.endsWith(".json"));
    if (f) {
      const req = JSON.parse(readFileSync(join(io, "req", f), "utf8"));
      assert.equal(`${req.id}.json`, f);
      assert.equal(req.tool, "ask_human");
      writeFileSync(join(io, "res", f), JSON.stringify({ content: [{ type: "text", text: "yes" }] }));
    }
  });
  const r = await p;
  assert.deepEqual(r, { content: [{ type: "text", text: "yes" }], isError: false });
  assert.equal(readdirSync(join(io, "res")).length, 1, "the answer file stays: the run cannot write io/res, the factory removes the folder at the end");
});
