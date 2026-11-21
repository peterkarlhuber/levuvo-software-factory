#!/usr/bin/env node
// Levuvo SF factory service: wires settings, briefing, interview, runner and the internal API together.
// Paths (volumes, see compose.yaml): /var/lib/levuvo/data (state, factory only), /var/lib/levuvo/runs (the run
// folders; a run container sees only its own `in` read-only and `io`), /run/levuvo/tokens (run tokens for the model
// gateway), /var/lib/levuvo/usage (the gateway's usage records, read-only here), /run/levuvo/git (Forgejo token,
// read-only here). Skills, templates and the price table come from the image, i.e. from the factory repo.
import { hostname } from "node:os";
import { mkdirSync, readFileSync } from "node:fs";
import { createBriefing } from "./briefing.mjs";
import { createDocker } from "./docker.mjs";
import { createForgejo } from "./forgejo.mjs";
import { createInterview } from "./interview.mjs";
import { createRunner } from "./runner.mjs";
import { createSettings } from "./settings.mjs";
import { createValidator } from "./schemas.mjs";
import { createApi, createProjects } from "./server.mjs";
import { createLocks, readJson, writeJson } from "./store.mjs";

const PORT = Number(process.env.LEVUVO_SF_API_PORT ?? 3100);
const dirs = { data: "/var/lib/levuvo/data", runs: "/var/lib/levuvo/runs", tokens: "/run/levuvo/tokens", usage: "/var/lib/levuvo/usage" };
const log = (o) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...o }) + "\n");

for (const d of [dirs.data, `${dirs.data}/projects`, `${dirs.data}/runs`, dirs.runs]) mkdirSync(d, { recursive: true });
const validator = createValidator(process.env.LEVUVO_SF_TEMPLATES ?? "/opt/levuvo/templates");
const settings = createSettings(`${dirs.data}/settings.json`);
const briefing = createBriefing({ dataDir: dirs.data, validator });
const interview = createInterview({ dataDir: dirs.data, briefing, validator, settings: settings.get });
const docker = createDocker();
const projects = createProjects({ dataDir: dirs.data, forgejo: createForgejo(), readJson, writeJson });
const prices = JSON.parse(readFileSync("/opt/levuvo/prices.json", "utf8"));

// the compose project name (levuvo-sf, or levuvo-sf-test in the tests) decides the names of the runs volume and the
// agent network; it is read from this container's own labels, never from a request
const self = await docker.self(hostname());
const composeProject = self.Config.Labels["com.docker.compose.project"];
if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(composeProject ?? "")) throw new Error("cannot tell the compose project");

const lock = createLocks(); // one lock per project, shared by the runner and the briefing upload
const runner = createRunner({
  dirs, docker, interview, briefing, settings: settings.get, prices, project: projects.get, lock,
  skillsDir: "/opt/levuvo/skills", composeProject, log,
});
await runner.recover(projects.list().map((p) => p.slug));
createApi({ port: PORT, projects, briefing, interview, runner, settings, lock, log }).listen(3100, "0.0.0.0", () => log({ action: "listening", port: 3100, project: composeProject }));
// docker compose stop: end every active run cleanly (container removed, token revoked, record written) before exiting
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => {
  if (stopping) return;
  stopping = true;
  log({ action: "shutdown" });
  setTimeout(() => process.exit(1), 25_000).unref(); // compose gives 30 s (stop_grace_period); startup recovery is the fallback
  try { log({ action: "runs_stopped", runs: await runner.shutdown() }); } catch (e) { log({ action: "shutdown_error", error: e.message }); }
  process.exit(0);
});
