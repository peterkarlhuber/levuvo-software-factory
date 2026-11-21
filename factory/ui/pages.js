// Levuvo SF web UI screens: Needs you, Projects, New project, Project, Question, Settings.
// Each screen is `{ title, node, refresh(projects) }`: built once, then refresh() re-renders only parts without input
// fields, so nothing the owner types is lost while the page updates (block 3 scope finding 9).
import { del, fileToBase64, get, post, put } from "./api.js";
import { actionButton, card, chip, details, errorBox, h, icon, showError, size, when } from "./dom.js";
import { ERROR_REASONS, reason, sectionStatus, t } from "./i18n.js";
import { questionForm, questionHead } from "./question.js";

const SECTIONS = ["Vision", "Problem", "Users", "Alternatives", "Goals and success criteria", "Non-goals", "Scope", "Quality", "Constraints", "Open questions"];
const go = (hash) => { location.hash = hash; };
const enc = encodeURIComponent;
const statusChip = (iv) => chip(t(`st_${iv.status}`), { waiting_for_human: "warn", running: "info", finished: "ok" }[iv.status] ?? "");

/** What waits for the owner, oldest first (block 3 scope: "Needs you"). */
export function inboxItems(projects) {
  const items = [];
  for (const p of projects) {
    const iv = p.interview;
    if (p.deleting) items.push({ p, kind: "deleting", at: p.created_at });
    else if (iv.open_question && iv.status !== "running") items.push({ p, kind: "question", at: iv.open_question.asked_at });
    else if (iv.status === "paused") items.push({ p, kind: ERROR_REASONS.includes(iv.last_exit_reason) ? "error" : "paused", at: p.created_at });
    else if (iv.status === "idle" && p.briefing_files > 0) items.push({ p, kind: "ready", at: p.created_at });
  }
  return items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

async function startInterview(slug) {
  await post(`/api/projects/${enc(slug)}/interview/start`);
  go(`#/p/${enc(slug)}`);
}

export function inboxPage(ctx) {
  const list = h("div", { class: "stack", "data-testid": "inbox" });
  const runningBox = h("div");
  const node = h("section", {}, h("header", { class: "page-head" }, h("h1", {}, t("inbox"))), list, runningBox);
  function refresh(projects) {
    const items = inboxItems(projects);
    list.replaceChildren(...(items.length ? items.map(({ p, kind }) => itemCard(p, kind)) : [h("p", { class: "empty" }, t("nothingWaiting"))]));
    const running = projects.filter((p) => p.interview.status === "running");
    runningBox.replaceChildren(...(running.length ? [h("h2", { class: "sub" }, t("running")), h("ul", { class: "plain" }, running.map((p) => h("li", {}, h("a", { href: `#/p/${enc(p.slug)}` }, p.name), " · ", t("agentWorking"))))] : []));
  }
  function itemCard(p, kind) {
    const iv = p.interview;
    const open = () => go(`#/p/${enc(p.slug)}`);
    if (kind === "question") return card({ testid: "inbox-item", kind: t("kindQuestion"), kindClass: "warn", meta: `${when(iv.open_question.asked_at)} · ${p.name}`, title: iv.open_question.decision_needed, action: h("a", { class: "btn primary", href: `#/p/${enc(p.slug)}/q/${enc(iv.open_question.id)}` }, t("answer")) });
    if (kind === "paused" || kind === "error") return card({ testid: "inbox-item", kind: kind === "error" ? t("kindError") : t("kindPaused"), kindClass: kind === "error" ? "bad" : "", title: p.name, lines: [reason(iv.last_exit_reason)], action: actionButton(t("resume"), () => startInterview(p.slug), { busyText: t("loading"), iconName: "play", onError: ctx.error }) });
    if (kind === "ready") return card({ testid: "inbox-item", kind: t("kindReady"), title: p.name, lines: [t("readyText")], action: actionButton(t("start"), () => startInterview(p.slug), { busyText: t("loading"), iconName: "play", onError: ctx.error }) });
    return card({ testid: "inbox-item", kind: t("kindDeleting"), kindClass: "bad", title: p.name, lines: [t("deletingText")], action: h("button", { class: "btn", type: "button", onclick: open }, t("open")) });
  }
  return { title: t("inbox"), node, refresh };
}

export function projectsPage() {
  const list = h("div", { class: "stack", "data-testid": "project-list" });
  const node = h("section", {},
    h("header", { class: "page-head" }, h("h1", {}, t("projects")), h("a", { class: "btn primary", href: "#/new", "data-testid": "new-project" }, icon("plus"), t("newProject"))),
    list);
  function refresh(projects) {
    list.replaceChildren(...(projects.length ? projects.map((p) => h("a", { class: "row", href: `#/p/${enc(p.slug)}`, "data-testid": "project-row" },
      h("span", { class: "row-main" }, h("strong", {}, p.name), h("span", { class: "muted" }, p.description)),
      statusChip(p.interview), icon("chevron"))) : [h("p", { class: "empty" }, t("noProjects"))]));
  }
  return { title: t("projects"), node, refresh };
}

export function newProjectPage() {
  const name = h("input", { name: "name", required: true, maxLength: 80, autocomplete: "off", "data-testid": "project-name" });
  const idea = h("textarea", { name: "idea", rows: 6, "data-testid": "project-idea" });
  const files = h("input", { type: "file", multiple: true, "data-testid": "project-files" });
  const err = errorBox();
  const submit = h("button", { class: "btn primary", type: "submit", "data-testid": "project-create" }, t("create"));
  const form = h("form", { class: "form" },
    h("label", { class: "field" }, h("span", {}, t("name")), name),
    h("label", { class: "field" }, h("span", {}, t("idea")), idea, h("small", { class: "muted" }, t("ideaHint"))),
    h("label", { class: "field" }, h("span", {}, t("files")), files),
    err, h("div", { class: "actions" }, submit));
  let slug = null; // a retry after a failed upload continues with the same project
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    showError(err, null);
    if (!idea.value.trim() && !files.files.length) return showError(err, new Error(t("needIdeaOrFile")));
    submit.disabled = true;
    submit.textContent = t("creating");
    try {
      slug ??= (await post("/api/projects", { name: name.value })).slug;
      if (idea.value.trim()) await put(`/api/projects/${enc(slug)}/briefing`, { path: "idea.md", content_base64: await fileToBase64(new Blob([idea.value])) });
      for (const f of files.files) await put(`/api/projects/${enc(slug)}/briefing`, { path: f.name, content_base64: await fileToBase64(f) });
      go(`#/p/${enc(slug)}`);
    } catch (e) {
      showError(err, e);
      submit.disabled = false;
      submit.textContent = t("create");
    }
  });
  return { title: t("newProject"), node: h("section", {}, h("header", { class: "page-head" }, h("h1", {}, t("newProject"))), form) };
}

export function projectPage(ctx, slug) {
  const state = { prd: true }; // which collapsible parts are open (kept across refreshes)
  const head = h("div");
  const body = h("div", { class: "stack" });
  const err = errorBox();
  const node = h("section", {}, head, err, body);
  const runCache = new Map();
  const fail = (e) => showError(err, e);
  const base = `/api/projects/${enc(slug)}`;

  async function refresh() {
    const [p, iv, inv] = await Promise.all([get(base), get(`${base}/interview`), get(`${base}/briefing`)]).catch((e) => {
      if (e.status === 404) { head.replaceChildren(h("h1", {}, t("notFound"))); body.replaceChildren(); return []; }
      throw e;
    });
    if (!p) return false;
    head.replaceChildren(h("header", { class: "page-head" },
      h("div", {}, h("h1", { "data-testid": "project-title" }, p.name), h("div", { class: "head-meta" }, statusChip(iv), iv.status === "paused" && iv.last_exit_reason ? h("span", { class: "muted" }, reason(iv.last_exit_reason)) : null)),
      mainAction(p, iv, inv)));
    body.replaceChildren(
      ...(iv.open_question && iv.status !== "running" ? [card({ testid: "open-question", kind: t("kindQuestion"), kindClass: "warn", title: iv.open_question.decision_needed, lines: [t("waitingQuestion")], action: h("a", { class: "btn primary", href: `#/p/${enc(slug)}/q/${enc(iv.open_question.id)}` }, t("answer")) })] : []),
      ...(iv.status === "running" ? [h("p", { class: "working", "data-testid": "working" }, h("span", { class: "dot" }), t("agentWorking"))] : []),
      details(state, "prd", t("prd"), prdView(iv)),
      details(state, "features", `${t("features")} (${iv.features.length})`, featuresView(iv)),
      details(state, "briefing", `${t("briefing")} (${inv.files.length})`, briefingView(inv, p)),
      details(state, "history", `${t("history")} (${iv.log.entries.length})`, historyView(iv)),
      details(state, "runs", `${t("runs")} (${iv.log.runs.length})`, runsView(iv), { onOpen: () => loadRuns(iv).catch(fail) }),
      details(state, "props", t("properties"), propsView(p)));
    if (state.runs) loadRuns(iv);
    return !!iv.active_run;
  }

  function mainAction(p, iv, inv) {
    if (p.deleting) return h("button", { class: "btn danger", type: "button", onclick: () => confirmDelete(p) }, icon("trash"), t("deleteProject"));
    if (iv.active_run) return actionButton(t("pause"), async () => { await post(`${base}/interview/pause`); await refresh(); }, { kind: "", iconName: "pause", busyText: t("loading"), onError: fail, testid: "pause" });
    if (iv.status === "finished") return null;
    if (!inv.files.length) return null;
    const label = iv.status === "idle" ? t("start") : t("resume");
    return actionButton(label, async () => { await post(`${base}/interview/start`); await refresh(); }, { iconName: "play", busyText: t("loading"), onError: fail, testid: "start" });
  }

  function prdView(iv) {
    return h("ol", { class: "prd", "data-testid": "prd" }, SECTIONS.map((name, i) => {
      const s = iv.prd[i + 1];
      return h("li", { class: `prd-section ${s.status}` },
        h("div", { class: "prd-title" }, h("span", {}, `${i + 1} ${name}`), chip(sectionStatus(s.status), { confirmed: "ok", deferred: "", drafted: "info" }[s.status] ?? "muted")),
        s.content && h("p", { class: "prd-text" }, s.content),
        s.source && h("p", { class: "source" }, s.source));
    }));
  }

  function featuresView(iv) {
    if (!iv.features.length) return h("p", { class: "muted" }, t("noFeatures"));
    return h("ul", { class: "plain features", "data-testid": "features" }, iv.features.map((f) => h("li", {},
      h("div", {}, h("strong", {}, `${f.id} · ${f.name}`), " ", chip(f.priority, f.priority === "must" ? "info" : "")),
      h("p", { class: "muted" }, f.summary))));
  }

  function briefingView(inv, p) {
    const input = h("input", { type: "file", multiple: true, class: "sr-only", "data-testid": "briefing-files" });
    const add = h("label", { class: "btn" }, icon("plus"), t("addFiles"), input);
    input.addEventListener("change", async () => {
      add.classList.add("busy");
      try { for (const f of input.files) await put(`${base}/briefing`, { path: f.name, content_base64: await fileToBase64(f) }); } catch (e) { fail(e); }
      add.classList.remove("busy");
      await refresh().catch(fail);
    });
    return h("div", {},
      h("ul", { class: "plain files", "data-testid": "briefing-list" }, inv.files.map((f) => h("li", {},
        h("div", { class: "row-main" },
          h("span", {}, f.path.replace(/^briefing\//, "")),
          h("span", { class: f.readable ? "muted" : "warn-text" }, [size(f.size_bytes), f.readable ? t("readable") : `${t("notReadable")}: ${f.unreadable_reason}`, f.answer_ref ? `${t("fromAnswer")} ${f.answer_ref}` : null].filter(Boolean).join(" · "))),
        f.added_via === "upload" && !p.deleting ? actionButton(t("remove"), async () => { await del(`${base}/briefing`, { path: f.path }); await refresh(); }, { kind: "ghost", iconName: "trash", onError: fail }) : null))),
      p.deleting ? null : add);
  }

  function historyView(iv) {
    if (!iv.log.entries.length) return h("p", { class: "muted" }, t("noHistory"));
    return h("ol", { class: "plain history" }, iv.log.entries.map((e) => h("li", {},
      h("strong", {}, `${e.question.id} · ${e.question.decision_needed}`),
      e.answer ? h("p", {}, `${t("answered")}: ${e.answer.text}${e.answer.attachments ? ` (${e.answer.attachments.map((a) => a.path.split("/").pop()).join(", ")})` : ""}`) : h("p", { class: "muted" }, "–"))));
  }

  const runsList = h("ul", { class: "plain runs" });
  function runsView(iv) {
    runsList.replaceChildren(...iv.log.runs.slice().reverse().map((r) => runLine(r)));
    return runsList;
  }
  function runLine(r) {
    const rec = runCache.get(r.run_id);
    const u = rec?.usage;
    return h("li", {}, h("span", {}, when(r.started_at)), " · ", h("span", {}, reason(rec?.exit_reason ?? r.end_reason) || t("agentWorking")),
      u ? h("span", { class: "muted" }, ` · ${t("cost")}: ${u.cost_is_lower_bound ? "≥ " : ""}$${u.estimated_cost_usd ?? "?"}${u.web_search_requests ? ` · ${u.web_search_requests} ${t("searches")}` : ""}`) : null);
  }
  async function loadRuns(iv) {
    const missing = iv.log.runs.filter((r) => !runCache.get(r.run_id)?.ended_at);
    if (!missing.length) return;
    for (const r of missing) runCache.set(r.run_id, await get(`/api/runs/${enc(r.run_id)}`).catch(() => null));
    runsView(iv);
  }

  function propsView(p) {
    const box = h("input", { type: "checkbox", checked: p.web_search === true, disabled: !!p.deleting, "data-testid": "web-search" });
    box.addEventListener("change", async () => {
      box.disabled = true;
      try { await put(base, { web_search: box.checked }); } catch (e) { box.checked = !box.checked; fail(e); }
      box.disabled = false;
    });
    return h("div", { class: "stack" },
      h("label", { class: "switch" }, box, h("span", {}, h("strong", {}, t("webSearch")), h("small", { class: "muted" }, t("webSearchNote")))),
      p.repo?.web_url ? h("p", { class: "muted" }, `${t("repo")}: ${p.repo.org}/${p.repo.name}`) : null,
      h("div", {}, h("button", { class: "btn danger", type: "button", onclick: () => confirmDelete(p), "data-testid": "delete-project" }, icon("trash"), t("deleteProject"))));
  }

  function confirmDelete(p) {
    const dialog = document.getElementById("dialog");
    const typed = h("input", { autocomplete: "off", "data-testid": "delete-confirm" });
    const derr = errorBox();
    const yes = h("button", { class: "btn danger", type: "submit", disabled: true, "data-testid": "delete-yes" }, t("deleteProject"));
    typed.addEventListener("input", () => { yes.disabled = typed.value.trim() !== p.name; });
    const form = h("form", { method: "dialog", class: "form" },
      h("h2", {}, t("deleteTitle")), h("p", {}, t("deleteText")),
      h("label", { class: "field" }, h("span", {}, `${t("typeName")}: `, h("strong", {}, p.name)), typed),
      derr, h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, t("cancel")), yes));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      yes.disabled = true;
      yes.textContent = t("deleting");
      try { await del(base, { confirm: typed.value.trim() }); dialog.close(); go("#/projects"); } catch (e) {
        showError(derr, e);
        yes.textContent = t("deleteProject");
        yes.disabled = false;
      }
    });
    dialog.replaceChildren(form);
    dialog.showModal();
    typed.focus();
  }

  return { title: t("projects"), node, refresh };
}

export function questionPage(ctx, slug, qid) {
  const base = `/api/projects/${enc(slug)}`;
  const node = h("section", {});
  const notice = h("p", { class: "notice", hidden: true });
  let built = false;
  async function refresh() {
    const [p, iv] = await Promise.all([get(base), get(`${base}/interview`)]);
    const entry = iv.log.entries.find((e) => e.question.id === qid);
    if (!entry) { node.replaceChildren(h("h1", {}, t("notFound"))); return false; }
    if (!built) {
      built = true;
      node.replaceChildren(
        h("header", { class: "page-head" }, h("div", {}, h("a", { class: "back", href: `#/p/${enc(slug)}` }, p.name), h("h1", {}, `${t("question")} ${qid}`))),
        notice,
        h("div", { class: "card question" }, questionHead(entry.question),
          entry.answer ? null : questionForm(entry.question, async (body) => {
            await post(`${base}/interview/answer`, { question_id: qid, ...body });
            go(`#/p/${enc(slug)}`);
          })));
    }
    if (entry.answer) { // answered here or elsewhere: no second answer (finding 9)
      notice.hidden = false;
      notice.replaceChildren(t("alreadyAnswered"), " ", h("a", { href: `#/p/${enc(slug)}` }, t("backToProject")));
      node.querySelector("form")?.remove();
    }
    return !!iv.active_run;
  }
  return { title: t("question"), node, refresh };
}

export function settingsPage(ctx) {
  const err = errorBox();
  const ok = h("p", { class: "notice", hidden: true, role: "status" });
  const node = h("section", {}, h("header", { class: "page-head" }, h("h1", {}, t("settings"))), h("p", {}, t("loading")));
  get("/api/settings").then((s) => {
    const lang = h("select", { name: "lang", "data-testid": "settings-language" }, [["de", "Deutsch"], ["en", "English"]].map(([v, l]) => h("option", { value: v, selected: s.human_language.startsWith(v) }, l)));
    const num = (v, testid) => h("input", { type: "number", min: 1, step: 1, value: String(v), "data-testid": testid, inputmode: "numeric" });
    const wait = num(s.ask_human_wait_minutes, "settings-wait"), idle = num(s.idle_stop_minutes, "settings-idle"), turns = num(s.max_turns_per_run, "settings-turns");
    const roles = Object.entries(s.roles).map(([role, r]) => ({
      role,
      model: h("input", { value: r.model, "aria-label": `${role} model`, autocomplete: "off" }),
      effort: h("select", { "aria-label": `${role} effort` }, ["low", "medium", "high", "xhigh", "max"].map((e) => h("option", { value: e, selected: e === r.effort }, e))),
    }));
    const save = h("button", { class: "btn primary", type: "submit", "data-testid": "settings-save" }, t("save"));
    const form = h("form", { class: "form" },
      h("label", { class: "field" }, h("span", {}, t("language")), lang),
      h("label", { class: "field" }, h("span", {}, t("waitMinutes")), wait),
      h("label", { class: "field" }, h("span", {}, t("idleMinutes")), idle),
      h("label", { class: "field" }, h("span", {}, t("maxTurns")), turns),
      details({}, "roles", t("roles"), h("div", { class: "roles" }, roles.map((r) => h("div", { class: "role" }, h("span", {}, r.role), r.model, r.effort)))),
      err, ok, h("div", { class: "actions" }, save));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      showError(err, null);
      ok.hidden = true;
      save.disabled = true;
      try {
        const next = await put("/api/settings", {
          human_language: lang.value, ask_human_wait_minutes: Number(wait.value), idle_stop_minutes: Number(idle.value), max_turns_per_run: Number(turns.value),
          roles: Object.fromEntries(roles.map((r) => [r.role, { model: r.model.value.trim(), effort: r.effort.value }])),
        });
        if (next.human_language !== s.human_language) return ctx.languageChanged(next.human_language);
        ok.textContent = t("saved");
        ok.hidden = false;
      } catch (e) { showError(err, e); } finally { save.disabled = false; }
    });
    node.replaceChildren(node.firstChild, form);
  }, (e) => { node.replaceChildren(node.firstChild, err); showError(err, e); });
  return { title: t("settings"), node };
}
