// JSON Schema 2020-12 validation (PLAYBOOK R10, G10.x) with Ajv against the repo's templates, which stay the
// authority. The factory additionally checks references, sources and approvals in its own code.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

export const TEMPLATES = process.env.LEVUVO_SF_TEMPLATES ?? new URL("../../../templates/", import.meta.url).pathname;

const FILES = ["question/question-answer.schema.json", "interview/interview-log.schema.json", "features/features.schema.json", "briefing/inventory.schema.json"];

export function createValidator(dir = TEMPLATES) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of FILES) ajv.addSchema(JSON.parse(readFileSync(`${dir.replace(/\/?$/, "/")}${f}`, "utf8")));
  const get = (id) => { const v = ajv.getSchema(id); if (!v) throw new Error(`schema missing: ${id}`); return v; };
  const ids = {
    question: "urn:levuvo:sf:schema:question-answer:0.2",
    log: "urn:levuvo:sf:schema:interview-log:0.2",
    features: "urn:levuvo:sf:schema:features:0.3",
    inventory: "urn:levuvo:sf:schema:briefing-inventory:0.1",
  };
  const check = (name, value) => {
    const v = get(ids[name]);
    if (v(value)) return null;
    return v.errors.slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  };
  return { check, ajv };
}
