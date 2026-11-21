#!/usr/bin/env node
// Levuvo SF run start inside the worker container: starts the official Claude CLI with the run profile the factory
// chose (AGENTS.md "Run profile"; PLAYBOOK G7.3). The factory wrote the skill (system prompt), the start message and
// the tool list into /run/levuvo/in (read-only here) and passes model, effort and turn cap as environment variables.
//   --bare --tools ""                no built-in tools: no shell, no file read or write, no web tools
//   with web search on (LEVUVO_SF_WEB_SEARCH=1, interviewer only, owner opt-in):
//   --restricted --tools WebSearch   `--bare` drops WebSearch in CLI 2.1.330, so these runs use restricted mode: no
//                                    command or code tools, no WebFetch, no user/project/local settings files; plus
//                                    CLAUDE_CODE_DISABLE_AUTO_MEMORY / _CLAUDE_MDS / _BUNDLED_SKILLS (what --bare skips).
//   CLAUDE_CODE_DISABLE_ATTACHMENTS=1  always: no `@` file references; files come only through the factory's tools
//                                    WebSearch makes a model call with Anthropic's server-side search; the container
//                                    still reaches only the model gateway, which allows no other server-side tool.
//   --strict-mcp-config + mcp.json   only the factory's own MCP server (this image's mcp.mjs)
//   --allowedTools <six names>       exactly the run's tools by name, no wildcard; anything else is denied
//   --permission-mode dontAsk        nothing is ever asked; whatever is not allowed is refused
//   --disable-slash-commands         no skills or commands from anywhere else
//   --system-prompt-file             the selected skill from the factory repo replaces the default prompt
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const IN = process.env.LEVUVO_SF_IN ?? "/run/levuvo/in";
const MODEL = /^claude-[a-z0-9-]{2,60}$/;
const EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);
const TOOL = /^[a-z_]{3,40}$/;

export function cliArgs(env, tools, dir = IN) {
  if (!MODEL.test(env.LEVUVO_SF_MODEL ?? "")) throw new Error("invalid model");
  if (!EFFORT.has(env.LEVUVO_SF_EFFORT)) throw new Error("invalid effort");
  const turns = Number(env.LEVUVO_SF_MAX_TURNS);
  if (!Number.isInteger(turns) || turns < 1 || turns > 10000) throw new Error("invalid turn cap");
  if (!tools.length || !tools.every((t) => TOOL.test(t))) throw new Error("invalid tool list");
  if (!["0", "1"].includes(env.LEVUVO_SF_WEB_SEARCH ?? "0")) throw new Error("invalid web search switch");
  const search = env.LEVUVO_SF_WEB_SEARCH === "1";
  const allowed = tools.map((t) => `mcp__factory__${t}`);
  if (search) allowed.push("WebSearch");
  return [
    "-p", readFileSync(`${dir}/prompt.md`, "utf8"),
    ...(search ? ["--restricted", "--tools", "WebSearch"] : ["--bare", "--tools", ""]),
    "--mcp-config", "/tmp/levuvo-mcp.json", "--strict-mcp-config",
    "--allowedTools", allowed.join(","),
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
    "--system-prompt-file", `${dir}/system.md`,
    "--model", env.LEVUVO_SF_MODEL, "--effort", env.LEVUVO_SF_EFFORT, "--max-turns", String(turns),
    "--output-format", "stream-json", "--verbose", "--no-session-persistence",
  ];
}

/** The CLI's environment: `@` file references are never resolved (files come only through the factory's tools; branch
 * review finding 3); with web search on, also switch off what `--bare` would have skipped. */
export function cliEnv(env) {
  const out = { ...env, CLAUDE_CODE_DISABLE_ATTACHMENTS: "1" };
  if (env.LEVUVO_SF_WEB_SEARCH !== "1") return out;
  return { ...out, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tools = JSON.parse(readFileSync(`${IN}/tools.json`, "utf8")).map((t) => t.name);
  writeFileSync("/tmp/levuvo-mcp.json", JSON.stringify({ mcpServers: { factory: { type: "stdio", command: "node", args: [process.env.LEVUVO_SF_MCP ?? "/opt/levuvo/mcp.mjs"] } } }));
  const child = spawn("claude", cliArgs(process.env, tools), { stdio: ["ignore", "inherit", "inherit"], env: cliEnv(process.env) });
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 143 : 1)));
}
