#!/usr/bin/env node
// Levuvo SF factory tools inside a run container: a stdio MCP server (newline-delimited JSON-RPC 2.0) that only relays.
// It has no network and no logic of its own. The tool list comes from the factory (/run/levuvo/in/tools.json, read-only);
// every call is written as a request file into the run's only writable folder (/run/levuvo/io/req) and the server waits
// for the factory's answer file (/run/levuvo/io/res). The factory validates and executes every call and alone writes
// the project's state (AGENTS.md: write only via tools; PLAYBOOK G2.1, G11.1). How long a call may wait (e.g.
// `ask_human`) is the factory's decision: it ends the run when the wait is over.
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const IN = process.env.LEVUVO_SF_IN ?? "/run/levuvo/in";
export const IO = process.env.LEVUVO_SF_IO ?? "/run/levuvo/io";
const POLL_MS = 200;

export function loadTools(dir = IN) {
  const tools = JSON.parse(readFileSync(`${dir}/tools.json`, "utf8"));
  if (!Array.isArray(tools)) throw new Error("tools.json must be a list");
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Writes the request atomically and waits for the answer file; returns the MCP tool result. */
export async function relay(name, args, io = IO, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const id = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const tmp = `${io}/req/.${id}.tmp`;
  writeFileSync(tmp, JSON.stringify({ id, tool: name, args: args ?? {} }));
  renameSync(tmp, `${io}/req/${id}.json`);
  for (;;) {
    let text;
    try { text = readFileSync(`${io}/res/${id}.json`, "utf8"); } catch { await sleep(POLL_MS); continue; }
    const r = JSON.parse(text);
    return { content: Array.isArray(r.content) ? r.content : [{ type: "text", text: String(r.text ?? "") }], isError: r.isError === true };
  }
}

export function createHandler({ tools, call = relay, serverName = "factory" }) {
  const names = new Set(tools.map((t) => t.name));
  return async (msg) => {
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    const error = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
    switch (msg.method) {
      case "initialize":
        return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: serverName, version: "1.0.0" } });
      case "ping": return reply({});
      case "tools/list": return reply({ tools });
      case "tools/call": {
        const name = msg.params?.name;
        if (!names.has(name)) return reply({ content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
        try { return reply(await call(name, msg.params?.arguments)); }
        catch (e) { return reply({ content: [{ type: "text", text: `The factory could not run the tool: ${e.message}` }], isError: true }); }
      }
      default:
        if (msg.id === undefined) return null; // notifications need no answer
        return error(-32601, `method not found: ${msg.method}`);
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = createHandler({ tools: loadTools() });
  createInterface({ input: process.stdin }).on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  });
}
