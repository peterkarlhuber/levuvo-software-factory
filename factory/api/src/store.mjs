// Levuvo SF factory state: JSON files in the factory's own volume, written atomically (temporary file + rename), so an
// interrupted write never leaves a half file behind. Only the factory process writes here; no agent mounts it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

export function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { if (e.code === "ENOENT" && fallback !== undefined) return fallback; throw e; }
}

export function writeAtomic(path, data, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${dirname(path)}/.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
}

export const writeJson = (path, value, mode) => writeAtomic(path, JSON.stringify(value, null, 2) + "\n", mode);

/** Serializes async work per key (one project or run at a time), so two requests never interleave their writes. */
export function createLocks() {
  const tails = new Map();
  return (key, fn) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return next;
  };
}
