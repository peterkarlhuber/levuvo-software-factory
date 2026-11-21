// Levuvo SF briefing (WORKFLOW A1): stores uploaded files, screens them before any agent access and keeps the
// inventory (GA1.2–GA1.5, G7.5).
// - Paths are checked before any file access: relative, plain segments, no `..`, no hidden files (GA1.2).
// - Files over 20 MB are refused until Git LFS support exists (GA1.3).
// - Text files are scanned with gitleaks; a finding blocks the file: it is listed as not readable and never handed to
//   an agent (GA1.4). Images are not scanned (detection covers text only; the inventory says so).
// - Readable for agents in this version: plain text formats and images up to 5 MB; everything else is marked
//   unreadable with the reason, and the interviewer asks the human about it (GA1.5).
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readJson, writeAtomic, writeJson } from "./store.mjs";

export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_IMAGE = 5 * 1024 * 1024;
const TEXT = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", yaml: "application/yaml", yml: "application/yaml" };
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const OTHER = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", zip: "application/zip" };
export const GITLEAKS = process.env.LEVUVO_SF_GITLEAKS ?? "/usr/local/bin/gitleaks";

/** `notes/idea.md` → `briefing/notes/idea.md`, or null when the path is not acceptable. */
export function briefingPath(p) {
  if (typeof p !== "string") return null;
  const rel = p.replace(/^briefing\//, "");
  if (rel.length < 1 || rel.length > 200) return null;
  const segs = rel.split("/");
  if (segs.length > 5) return null;
  if (!segs.every((s) => /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,99}$/u.test(s) && !s.includes("..") && !s.endsWith(" ") && !s.endsWith("."))) return null;
  return `briefing/${rel}`;
}

export function mediaType(path) {
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "").toLowerCase();
  if (TEXT[ext]) return { type: TEXT[ext], kind: "text" };
  if (IMAGE[ext]) return { type: IMAGE[ext], kind: "image" };
  return { type: OTHER[ext] ?? "application/octet-stream", kind: "other" };
}

/** Text must really be UTF-8 text; images must carry their format's signature. */
function contentMatches(kind, type, buf) {
  if (kind === "text") return !buf.includes(0) && Buffer.from(buf.toString("utf8"), "utf8").equals(buf);
  if (kind === "image") {
    const sig = { "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff], "image/gif": [0x47, 0x49, 0x46, 0x38], "image/webp": [0x52, 0x49, 0x46, 0x46] }[type];
    return sig.every((b, i) => buf[i] === b);
  }
  return true;
}

/** gitleaks over one file; resolves to the number of findings (redacted, nothing is logged). */
export function scanText(buf, gitleaks = GITLEAKS) {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  const file = join(dir, "file.txt");
  writeFileSync(file, buf, { mode: 0o600 });
  return new Promise((resolve, reject) => {
    execFile(gitleaks, ["dir", file, "--no-banner", "--redact", "--report-format", "json", "--report-path", "-", "--exit-code", "0", "--log-level", "error"], { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }, (err, stdout) => {
      rmSync(dir, { recursive: true, force: true });
      if (err) return reject(new Error(`secret scan failed: ${err.message}`));
      try { resolve(JSON.parse(stdout || "[]").length); } catch { reject(new Error("secret scan returned no report")); }
    });
  });
}

export function createBriefing({ dataDir, validator, scan = scanText, scannerName = "gitleaks 8.30.1" }) {
  const dir = (slug) => `${dataDir}/projects/${slug}`;
  const invPath = (slug) => `${dir(slug)}/inventory.json`;
  const inventory = (slug) => readJson(invPath(slug), { version: 0, generated_at: new Date(0).toISOString(), files: [] });

  function saveInventory(slug, inv, bump) {
    const next = { ...inv, version: bump ? inv.version + 1 : inv.version, generated_at: new Date().toISOString() };
    const err = validator.check("inventory", next);
    if (err) throw new Error(`inventory invalid: ${err}`);
    writeJson(invPath(slug), next);
    return next;
  }

  /** Stores one file (new or replaced). Returns the inventory entry; throws `{status, message}` errors for the API. */
  async function put(slug, rawPath, buf) {
    const path = briefingPath(rawPath);
    if (!path) throw httpError(400, "invalid file path (plain names, at most 5 folders, no hidden files or ..)");
    if (buf.length === 0) throw httpError(400, "the file is empty");
    if (buf.length > MAX_FILE) throw httpError(413, "file larger than 20 MB (large files come with Git LFS support)");
    const { type, kind } = mediaType(path);
    const now = new Date().toISOString();
    let readable = false, reason, scanStatus = "clean", scanner;
    if (!contentMatches(kind, type, buf)) reason = `content does not match the file type ${type}`;
    else if (kind === "text") {
      scanner = scannerName;
      const found = await scan(buf);
      if (found > 0) { scanStatus = "blocked"; reason = `blocked: the secret scan found ${found} possible secret(s); remove them and upload the file again`; }
      else readable = true;
    } else if (kind === "image") {
      scanner = "none (images are not scanned, GA1.4)";
      if (buf.length > MAX_IMAGE) reason = "image larger than 5 MB";
      else readable = true;
    } else {
      scanner = "none (not a text file)";
      reason = `format ${type} cannot be read by agents yet`;
    }
    const entry = {
      path, media_type: type, size_bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), readable,
      ...(reason ? { unreadable_reason: reason } : {}),
      secret_scan: { status: scanStatus, ...(scanner ? { scanner } : {}), scanned_at: now }, added_via: "upload",
    };
    const inv = inventory(slug);
    const old = inv.files.find((f) => f.path === path);
    if (old?.sha256 === entry.sha256) return { entry: old, inventory: inv, changed: false };
    if (old?.tags) entry.tags = old.tags;
    const file = `${dir(slug)}/${path}`;
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, buf);
    const files = inv.files.filter((f) => f.path !== path).concat(entry).sort((a, b) => a.path.localeCompare(b.path));
    return { entry, inventory: saveInventory(slug, { ...inv, files }, true), changed: true };
  }

  function remove(slug, rawPath) {
    const path = briefingPath(rawPath);
    const inv = inventory(slug);
    if (!path || !inv.files.some((f) => f.path === path)) throw httpError(404, "no such briefing file");
    try { unlinkSync(`${dir(slug)}/${path}`); } catch { /* already gone */ }
    return saveInventory(slug, { ...inv, files: inv.files.filter((f) => f.path !== path) }, true);
  }

  /** Content for an agent: only readable, clean files whose stored bytes still match the inventory hash. */
  function readForAgent(slug, rawPath) {
    const path = briefingPath(rawPath);
    const f = path && inventory(slug).files.find((x) => x.path === path);
    if (!f) return { error: `There is no briefing file ${rawPath}.` };
    if (!f.readable) return { error: `${f.path} cannot be read: ${f.unreadable_reason}. Ask the human what it contains if you need it.` };
    const buf = readFileSync(`${dir(slug)}/${f.path}`);
    if (createHash("sha256").update(buf).digest("hex") !== f.sha256) return { error: `${f.path} changed on disk outside the factory; it is not handed out.` };
    return { file: f, buf, kind: mediaType(f.path).kind };
  }

  /** Tags are metadata: they do not create a new inventory version (GA2.3). */
  function tag(slug, rawPath, tagName, note, setBy) {
    const path = briefingPath(rawPath);
    const inv = inventory(slug);
    const f = path && inv.files.find((x) => x.path === path);
    if (!f) return `There is no briefing file ${rawPath}.`;
    f.tags = (f.tags ?? []).filter((t) => t.tag !== tagName).concat({ tag: tagName, ...(note ? { note } : {}), set_by: setBy });
    saveInventory(slug, inv, false);
    return null;
  }

  return { put, remove, inventory, readForAgent, tag };
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

