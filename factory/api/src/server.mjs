// Levuvo SF internal API and web UI (blocks 2 and 3; the UI is served from the same origin).
// Reachable only on the Mac (127.0.0.1:3100). Same-origin contract (scope review finding 11):
// - every request must carry an exact Host (localhost or 127.0.0.1 on the factory port): against DNS rebinding;
// - every changing request must be JSON (`Content-Type: application/json`) and carry no foreign Origin: against
//   cross-site requests from a web page; bodies are size-limited;
// - state changes happen only through the factory's own logic (interview, runner); the API never sets a status.
// - the UI is a fixed set of files from the image, read once at start; nothing uploaded is ever served (finding 8).
// No user accounts yet: the API is local only. Remote access (Tailscale) gets its own sign-in later.
import { createServer } from "node:http";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { renderFeatures, renderPrd } from "./interview.mjs";
import { ORG } from "./forgejo.mjs";

const SMALL = 64 * 1024;
const UPLOAD = 28 * 1024 * 1024; // 20 MB file as base64 in JSON
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const UI_TYPES = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", webmanifest: "application/manifest+json" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** The web UI: every regular file directly in `dir` with a known type, read once (served from memory, never from disk). */
export function loadUi(dir) {
  const files = new Map();
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name); } catch { return files; }
  for (const name of names) {
    const type = UI_TYPES[/\.([a-z]+)$/.exec(name)?.[1]];
    if (type && /^[a-z0-9][a-z0-9.-]*$/.test(name)) files.set(`/${name}`, { type, body: readFileSync(`${dir}/${name}`) });
  }
  if (files.has("/index.html")) files.set("/", files.get("/index.html"));
  return files;
}

export function createApi({ port, projects, briefing, interview, runner, settings, lock = (_, fn) => fn(), log = () => {}, ui = new Map() }) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  const routes = [
    ["GET", /^\/api\/health$/, () => ({ ok: true })],
    ["GET", /^\/api\/settings$/, () => settings.get()],
    ["PUT", /^\/api\/settings$/, (_, body) => { try { return settings.update(body); } catch (e) { throw status(400, e.message); } }],
    ["GET", /^\/api\/projects$/, () => projects.list().map((p) => summary(p))],
    ["POST", /^\/api\/projects$/, async (_, body) => projects.create(body)],
    ["GET", /^\/api\/projects\/([^/]+)$/, ([slug]) => overview(slug)],
    ["PUT", /^\/api\/projects\/([^/]+)$/, ([slug], body) => lock(slug, () => projects.update(slug, body))],
    ["DELETE", /^\/api\/projects\/([^/]+)$/, ([slug], body) => lock(slug, () => projects.remove(slug, body.confirm, {
      busy: runner.isActive(slug), runIds: interview.load(slug).log.runs.map((r) => r.run_id),
    }))],
    ["PUT", /^\/api\/projects\/([^/]+)\/briefing$/, async ([slug], body) => {
      projects.writable(slug);
      if (typeof body.path !== "string" || typeof body.content_base64 !== "string") throw status(400, "path and content_base64 are required");
      const buf = Buffer.from(body.content_base64, "base64");
      return lock(slug, async () => { // uploads, deletions and interview updates of one project never interleave
        projects.writable(slug);
        const r = await briefing.put(slug, body.path, buf);
        if (r.changed) interview.briefingChanged(slug, r.entry.path);
        return { file: r.entry, inventory_version: r.inventory.version };
      });
    }, UPLOAD],
    ["DELETE", /^\/api\/projects\/([^/]+)\/briefing$/, ([slug], body) => {
      projects.writable(slug);
      return lock(slug, () => {
        projects.writable(slug);
        const inv = briefing.remove(slug, body.path);
        interview.briefingChanged(slug, `briefing/${String(body.path).replace(/^briefing\//, "")}`);
        return { inventory_version: inv.version };
      });
    }],
    ["GET", /^\/api\/projects\/([^/]+)\/briefing$/, ([slug]) => { projects.get(slug); return briefing.inventory(slug); }],
    ["POST", /^\/api\/projects\/([^/]+)\/interview\/start$/, async ([slug]) => { projects.writable(slug); return runner.start(slug); }],
    ["POST", /^\/api\/projects\/([^/]+)\/interview\/pause$/, async ([slug]) => { projects.get(slug); return runner.pause(slug); }],
    ["POST", /^\/api\/projects\/([^/]+)\/interview\/answer$/, async ([slug], body) => {
      projects.get(slug);
      if (typeof body.question_id !== "string") throw status(400, "question_id is required");
      if (body.text !== undefined && (typeof body.text !== "string" || body.text.length > 8000)) throw status(400, "text must be a string up to 8000 characters");
      return runner.answer(slug, body.question_id, { text: body.text ?? "", chosen_option: body.chosen_option, attachments: body.attachments });
    }, UPLOAD],
    ["GET", /^\/api\/projects\/([^/]+)\/interview$/, ([slug]) => { projects.get(slug); return interviewView(slug); }],
    ["GET", /^\/api\/projects\/([^/]+)\/interview\/prd\.md$/, ([slug]) => md(renderPrd(projects.get(slug), interview.load(slug), briefing.inventory(slug).version))],
    ["GET", /^\/api\/projects\/([^/]+)\/interview\/features\.md$/, ([slug]) => md(renderFeatures(projects.get(slug), interview.load(slug)))],
    ["GET", /^\/api\/runs\/(run-[a-z0-9]+)$/, ([id]) => runner.runRecord(id) ?? (() => { throw status(404, "no such run"); })()],
  ];

  /** The stored interview; a run the runner no longer knows shows as paused (the next start reconciles it). */
  function current(slug) {
    const iv = interview.load(slug);
    if (iv.active_run && !runner.isLive(iv.active_run)) Object.assign(iv, { status: iv.status === "finished" ? "finished" : "paused", active_run: null, last_exit_reason: iv.last_exit_reason ?? "finish_failed" });
    return iv;
  }
  const openQuestion = (iv) => (iv.open_question ? iv.log.entries.find((e) => e.question.id === iv.open_question)?.question ?? null : null);
  /** One line per project for the project list and the "Needs you" inbox. */
  function summary(p) {
    const iv = current(p.slug);
    const q = openQuestion(iv) ?? iv.log.entries.find((e) => !e.answer)?.question ?? null; // asked before a pause too
    return {
      ...p, briefing_files: briefing.inventory(p.slug).files.length,
      interview: { status: iv.status, active: !!iv.active_run, last_exit_reason: iv.last_exit_reason, open_question: q ? { id: q.id, decision_needed: q.decision_needed, asked_at: q.asked_at } : null, runs: iv.log.runs.length },
    };
  }

  function interviewView(slug) {
    const iv = current(slug);
    const open = openQuestion(iv);
    return {
      status: iv.status, active_run: iv.active_run, last_exit_reason: iv.last_exit_reason, outdated: iv.outdated,
      open_question: open ?? null, unanswered: iv.log.entries.filter((e) => !e.answer).map((e) => e.question.id), prd: iv.prd, features: iv.features.features, log: iv.log, summary: iv.summary,
      output_secret_scan: iv.output_secret_scan ?? null,
      finish_blockers: iv.status === "finished" ? [] : interview.finishProblems(iv),
    };
  }
  function overview(slug) {
    const p = projects.get(slug);
    const inv = briefing.inventory(slug);
    const iv = current(slug);
    return { ...p, briefing: { version: inv.version, files: inv.files.length }, interview: { status: iv.status, open_question: iv.open_question, runs: iv.log.runs.map((r) => r.run_id) } };
  }

  return createServer(async (req, res) => {
    const send = (code, value, type = "application/json") => {
      const body = type === "application/json" ? JSON.stringify(value) : value;
      res.writeHead(code, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" });
      res.end(body);
    };
    try {
      if (!hosts.has(req.headers.host ?? "")) return send(421, { error: "wrong host (the factory API answers only to localhost)" });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const file = !url.pathname.startsWith("/api/") && ui.get(url.pathname);
      if (file) {
        if (req.method !== "GET" && req.method !== "HEAD") return send(405, { error: "not found" });
        res.writeHead(200, { "content-type": `${file.type}${/^text\//.test(file.type) ? "; charset=utf-8" : ""}`, "content-security-policy": CSP, "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin" });
        return res.end(req.method === "HEAD" ? undefined : file.body);
      }
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) return send(routes.some(([, re]) => re.test(url.pathname)) ? 405 : 404, { error: "not found" });
      const [method, re, fn, limit = SMALL] = route;
      let body = {};
      if (method !== "GET") {
        if (req.headers.origin && !origins.has(req.headers.origin)) return send(403, { error: "foreign origin" });
        if (!/^application\/json(;|$)/.test(req.headers["content-type"] ?? "")) return send(415, { error: "changing requests must be JSON" });
        const raw = await readBody(req, limit);
        try { body = raw.length ? JSON.parse(raw) : {}; } catch { return send(400, { error: "invalid JSON" }); }
        if (typeof body !== "object" || body === null || Array.isArray(body)) return send(400, { error: "the body must be a JSON object" });
      }
      const params = re.exec(url.pathname).slice(1).map(decodeURIComponent);
      if (params[0] && re.source.includes("projects") && !SLUG.test(params[0])) return send(404, { error: "no such project" });
      const out = await fn(params, body);
      if (out && out.__md) return send(200, out.text, "text/markdown");
      send(method === "POST" && /\/api\/projects$/.test(url.pathname) ? 201 : 200, out);
    } catch (e) {
      const code = e.status ?? 500;
      if (code >= 500) log({ action: "api_error", path: req.url, error: e.message });
      send(code, { error: code >= 500 && !e.status ? "internal error" : e.message });
    }
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c); // past the limit the rest is drained and dropped, then refused
    });
    req.on("end", () => (size > limit ? reject(status(413, "request too large")) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

const md = (text) => ({ __md: true, text });
export function status(code, message) { return Object.assign(new Error(message), { status: code }); }

/** Projects: name + slug, created with their private repository (A0). */
export function createProjects({ dataDir, forgejo, readJson, writeJson }) {
  const file = (slug) => `${dataDir}/projects/${slug}/project.json`;
  const get = (slug) => {
    if (!SLUG.test(slug)) throw status(404, "no such project");
    const p = readJson(file(slug), null);
    if (!p) throw status(404, "no such project");
    return p;
  };
  const list = () => {
    let dirs = [];
    try { dirs = readdirSync(`${dataDir}/projects`); } catch { /* none yet */ }
    return dirs.filter((d) => SLUG.test(d)).map((d) => readJson(file(d), null)).filter(Boolean);
  };
  let creating = Promise.resolve();
  const create = (body) => {
    const run = creating.then(() => createOne(body));
    creating = run.catch(() => {});
    return run;
  };
  const createOne = async (body) => {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) throw status(400, "name is required (1–80 characters)");
    const slug = typeof body.slug === "string" ? body.slug : name.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    if (!SLUG.test(slug)) throw status(400, "the project needs a slug of 3–40 characters: a-z, 0-9 and -");
    if (readJson(file(slug), null)) throw status(409, `a project named ${slug} already exists`);
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 200) : `Levuvo SF project ${name}`;
    const repo = await forgejo.createProjectRepo(slug, description);
    const project = { slug, name, description, created_at: new Date().toISOString(), repo, web_search: false };
    writeJson(file(slug), project);
    return project;
  };
  /** Refuses changes while the project is being deleted. */
  const writable = (slug) => {
    const p = get(slug);
    if (p.deleting) throw status(409, "the project is being deleted");
    return p;
  };

  /** Project properties the owner may change: web search for the interviewer (off by default; G7.5). */
  const update = (slug, body) => {
    const p = writable(slug);
    for (const k of Object.keys(body)) if (k !== "web_search") throw status(400, `unknown project property ${k}`);
    if (typeof body.web_search !== "boolean") throw status(400, "web_search must be true or false");
    const next = { ...p, web_search: body.web_search };
    writeJson(file(slug), next);
    return next;
  };

  /** Deletes the project: its own repository on the git server, then its factory data and run records. Runs under
   * the project lock; a failure leaves the mark `deleting` (no start, upload or answer) and can be retried
   * (scope review finding 4). Not undoable. */
  const remove = async (slug, confirm, { busy, runIds }) => {
    const p = get(slug);
    if (typeof confirm !== "string" || (confirm.trim() !== p.name && confirm.trim() !== slug)) throw status(400, "type the project name to confirm");
    if (busy) throw status(409, "an interview run is active: pause it first");
    writeJson(file(slug), { ...p, deleting: true });
    if (p.repo?.org === ORG && p.repo?.name === slug) {
      try { await forgejo.api("DELETE", `/repos/${ORG}/${slug}`); } catch (e) {
        if (e.status !== 404) throw status(502, `the repository could not be deleted (${e.message}); try again`);
      }
    }
    for (const id of runIds) if (/^run-[a-z0-9]+$/.test(id)) rmSync(`${dataDir}/runs/${id}`, { recursive: true, force: true });
    rmSync(`${dataDir}/projects/${slug}`, { recursive: true, force: true });
    return { deleted: slug };
  };
  return { get, list, create, update, remove, writable };
}
