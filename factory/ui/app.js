// Levuvo SF web UI: navigation, routing and the refresh loop. Every screen refreshes from the factory while it is
// shown (every 2 s while a run is active, else every 10 s), and the connection state is always visible
// (block 3 scope finding 10). The factory alone decides every state; the UI only shows it and sends requests.
import { get } from "./api.js";
import { h, icon } from "./dom.js";
import { setLanguage, t } from "./i18n.js";
import { inboxItems, inboxPage, newProjectPage, projectPage, projectsPage, questionPage, settingsPage } from "./pages.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const banner = document.getElementById("banner");
let page = null;
let timer = null;
let seq = 0;

const ctx = {
  error: (e) => showBanner(e.message, e.offline),
  languageChanged: (lang) => { setLanguage(lang); drawNav(0); route(); },
};

function showBanner(text, offline) {
  banner.hidden = !text;
  banner.className = `banner${offline ? " offline" : ""}`;
  banner.textContent = text ?? "";
}

function drawNav(count) {
  const here = location.hash.startsWith("#/settings") ? "settings" : /^#\/(projects|new|p\/)/.test(location.hash) ? "projects" : "inbox";
  const link = (key, href, ic, badge) => h("a", { href, class: here === key ? "active" : "", "aria-current": here === key ? "page" : null, "data-testid": `nav-${key}` },
    icon(ic), h("span", {}, t(key)), badge ? h("span", { class: "badge", "data-testid": "inbox-count" }, String(badge)) : null);
  nav.replaceChildren(link("inbox", "#/", "inbox", count), link("projects", "#/projects", "folder"), link("settings", "#/settings", "settings"));
}

function pageFor(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "projects") return projectsPage(ctx);
  if (parts[0] === "new") return newProjectPage(ctx);
  if (parts[0] === "settings") return settingsPage(ctx);
  if (parts[0] === "p" && parts[1] && parts[2] === "q" && parts[3]) return questionPage(ctx, parts[1], parts[3]);
  if (parts[0] === "p" && parts[1]) return projectPage(ctx, parts[1]);
  return inboxPage(ctx);
}

function route() {
  page = pageFor(location.hash);
  document.title = `${page.title} · Levuvo SF`;
  view.replaceChildren(page.node);
  showBanner(null);
  window.scrollTo(0, 0);
  tick();
}

/** One refresh: the project list (badge, inbox, project list) and the shown screen. */
async function tick() {
  clearTimeout(timer);
  const mine = ++seq;
  const shown = page;
  let active = false;
  try {
    const projects = await get("/api/projects");
    if (mine !== seq) return;
    drawNav(inboxItems(projects).length);
    active = projects.some((p) => p.interview.active);
    if (shown.refresh) active = (await shown.refresh(projects)) || active;
    if (banner.classList.contains("offline")) showBanner(null); // an action error stays until the next screen
  } catch (e) {
    showBanner(e.offline ? t("connectionLost") : e.message, e.offline);
  }
  if (mine === seq) timer = setTimeout(tick, active ? 2000 : 10000);
}

window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
get("/api/settings").then((s) => setLanguage(s.human_language), () => setLanguage("de")).finally(() => { drawNav(0); route(); });
