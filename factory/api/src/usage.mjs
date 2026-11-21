// Token usage and cost estimate of one run, from the model gateway's records (PLAYBOOK G11.2, G12.1). A call whose
// usage could not be read counts as unknown: the totals then say "at least", never zero for what is missing.
import { readFileSync } from "node:fs";

export function summarize(lines, prices) {
  const t = { calls: 0, incomplete_calls: 0, errors: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let cost = 0, costKnown = true;
  for (const l of lines) {
    if (l.error || (l.status && l.status !== 200)) { t.errors++; continue; }
    t.calls++;
    if (!l.complete) { t.incomplete_calls++; costKnown = false; }
    for (const f of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) t[f] += l[f] ?? 0;
    const p = prices.models[l.model];
    if (!p) { costKnown = false; continue; }
    cost += ((l.input_tokens ?? 0) * p.input + (l.output_tokens ?? 0) * p.output + (l.cache_creation_input_tokens ?? 0) * p.cache_write + (l.cache_read_input_tokens ?? 0) * p.cache_read) / 1e6;
  }
  return {
    ...t,
    tokens_complete: t.incomplete_calls === 0,
    estimated_cost_usd: Math.round(cost * 10000) / 10000,
    cost_is_lower_bound: !costKnown,
    price_table: prices.version,
  };
}

export function readUsage(file) {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
}
