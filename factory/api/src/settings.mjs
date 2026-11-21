// Levuvo SF settings (PLAYBOOK M3): model and effort per role (AGENTS.md, default Claude Opus 5.5 / medium), billing
// mode, the human's wait time for ask_human (G2.2), idle stop (G13.1), turn cap per run (G13.5), the human's language and
// web search per role (only the interviewer may have it; off until the owner switches it on, G7.5).
// Stored in the factory volume; a change applies from the next run.
import { readJson, writeJson } from "./store.mjs";

export const ROLES = ["interviewer", "designer", "skeleton_builder", "spec_writer", "planner", "scenario_tester", "builder", "reviewer", "triage"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Roles that may use Anthropic's server-side web search (AGENTS.md run profiles). */
export const WEB_SEARCH_ROLES = ["interviewer"];

export function defaults() {
  return {
    roles: Object.fromEntries(ROLES.map((r) => [r, { model: "claude-opus-5-5", effort: "medium", web_search: false }])),
    billing_mode: "api",
    ask_human_wait_minutes: 10,
    idle_stop_minutes: 15,
    max_turns_per_run: 300,
    human_language: "de",
  };
}

/** Validates a full or partial settings object merged onto `base`; throws with a readable message. */
export function merge(base, patch) {
  const out = structuredClone(base);
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("settings must be an object");
  for (const [k, v] of Object.entries(patch)) {
    if (k === "roles") {
      if (typeof v !== "object" || v === null) throw new Error("roles must be an object");
      for (const [role, rv] of Object.entries(v)) {
        if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
        if (rv.model !== undefined) { if (!/^claude-[a-z0-9-]{2,60}$/.test(rv.model)) throw new Error(`invalid model for ${role}`); out.roles[role].model = rv.model; }
        if (rv.effort !== undefined) { if (!EFFORTS.includes(rv.effort)) throw new Error(`invalid effort for ${role}`); out.roles[role].effort = rv.effort; }
        if (rv.web_search !== undefined) {
          if (typeof rv.web_search !== "boolean") throw new Error(`web_search for ${role} must be true or false`);
          if (rv.web_search && !WEB_SEARCH_ROLES.includes(role)) throw new Error(`web search is only available for: ${WEB_SEARCH_ROLES.join(", ")}`);
          out.roles[role].web_search = rv.web_search;
        }
        for (const extra of Object.keys(rv)) if (!["model", "effort", "web_search"].includes(extra)) throw new Error(`unknown role setting ${extra}`);
      }
    } else if (k === "billing_mode") {
      if (v !== "api") throw new Error("billing_mode: only \"api\" is available in this version (subscription comes later)");
      out.billing_mode = v;
    } else if (k === "ask_human_wait_minutes" || k === "idle_stop_minutes") {
      if (!Number.isInteger(v) || v < 1 || v > 24 * 60) throw new Error(`${k} must be a whole number of minutes from 1 to 1440`);
      out[k] = v;
    } else if (k === "max_turns_per_run") {
      if (!Number.isInteger(v) || v < 1 || v > 10000) throw new Error("max_turns_per_run must be from 1 to 10000");
      out[k] = v;
    } else if (k === "human_language") {
      if (typeof v !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) throw new Error("human_language must be a BCP 47 tag like de or en");
      out[k] = v;
    } else throw new Error(`unknown setting ${k}`);
  }
  return out;
}

export function createSettings(file) {
  let cache = null;
  const get = () => (cache ??= merge(defaults(), readJson(file, {})));
  const update = (patch) => { const next = merge(get(), patch); writeJson(file, next); cache = next; return next; };
  return { get, update };
}
