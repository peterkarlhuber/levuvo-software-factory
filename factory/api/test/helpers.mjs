import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBriefing } from "../src/briefing.mjs";
import { createInterview } from "../src/interview.mjs";
import { createValidator } from "../src/schemas.mjs";
import { defaults } from "../src/settings.mjs";

export const validator = createValidator(process.env.LEVUVO_SF_TEMPLATES ?? new URL("../../../templates/", import.meta.url).pathname);

/** A project with a briefing and an interview, a fake secret scanner (finds "SECRET" in text). */
export async function setup(files = { "notes.md": "We want a booking app for our tennis club." }) {
  const dataDir = mkdtempSync(join(tmpdir(), "sf-"));
  const settings = defaults();
  const briefing = createBriefing({ dataDir, validator, scan: async (buf) => (buf.toString().includes("SECRET") ? 1 : 0), scannerName: "fake" });
  const interview = createInterview({ dataDir, briefing, validator, settings: () => settings });
  for (const [p, c] of Object.entries(files)) await briefing.put("demo", p, Buffer.isBuffer(c) ? c : Buffer.from(c));
  const iv = interview.load("demo");
  iv.status = "running";
  iv.active_run = "run-test01";
  interview.save("demo", iv);
  const run = { id: "run-test01" };
  const call = (tool, args) => interview.call("demo", run, tool, args);
  call("read_briefing", {});
  return { dataDir, briefing, interview, call, settings, run };
}

export const textOf = (r) => r.content.map((c) => c.text ?? "").join("\n");

/** ask_human + answer, returns the question id. */
export function askAndAnswer(t, args, answerText = "yes") {
  const r = t.call("ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" }, ...args });
  if (!r.wait) throw new Error(`ask failed: ${textOf(r)}`);
  t.interview.answer("demo", r.wait.id, { text: answerText });
  return r.wait.id;
}
