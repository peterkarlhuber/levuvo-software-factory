// Levuvo SF web UI building blocks. Everything is built as DOM nodes; text is always set as text, never parsed as
// HTML, because questions, drafts and file names come from agents or uploads (R9).
import { locale } from "./i18n.js";

/** h("div", {class: "x", onclick: fn}, "text", child, [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  inbox: ["M4 13h4l2 3h4l2-3h4", "M5 5h14l2 8v6H3v-6z"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  settings: ["M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  plus: ["M12 5v14", "M5 12h14"],
  play: ["M7 4l13 8-13 8z"],
  pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  clip: ["M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"],
  alert: ["M12 3l10 18H2z", "M12 10v5", "M12 18v.5"],
  chevron: ["M9 6l6 6-6 6"],
};
/** A simple outline SVG icon. */
export function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "icon" })) svg.setAttribute(k, v);
  for (const d of ICONS[name] ?? []) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.append(p); }
  return svg;
}

export const chip = (text, kind = "") => h("span", { class: `chip ${kind}` }, text);

/** A card with an optional kind chip, title, lines and one main action. */
export function card({ kind, kindClass, meta, title, lines = [], action, testid }) {
  return h("article", { class: "card", "data-testid": testid },
    h("div", { class: "card-body" },
      (kind || meta) && h("div", { class: "card-meta" }, kind && chip(kind, kindClass), meta && h("span", {}, meta)),
      h("h3", {}, title),
      lines.filter(Boolean).map((l) => h("p", { class: "muted" }, l))),
    action && h("div", { class: "card-action" }, action));
}

/** A button that shows `busyText` and stays disabled while `fn` runs; errors go to `onError`. */
export function actionButton(label, fn, { busyText, kind = "primary", iconName, onError, testid } = {}) {
  const b = h("button", { class: `btn ${kind}`, type: "button", "data-testid": testid }, iconName && icon(iconName), label);
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true;
    const old = [...b.childNodes];
    if (busyText) b.replaceChildren(busyText);
    try { await fn(); } catch (e) { onError?.(e); } finally { b.disabled = false; b.replaceChildren(...old); }
  });
  return b;
}

/** Collapsible section that keeps its open state across re-renders (keyed in `state`). */
export function details(state, key, summary, body, { onOpen } = {}) {
  const d = h("details", { class: "section", open: !!state[key], "data-key": key }, h("summary", {}, summary), body);
  d.addEventListener("toggle", () => { state[key] = d.open; if (d.open) onOpen?.(); });
  return d;
}

export const when = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
export const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const errorBox = () => h("p", { class: "error", role: "alert", hidden: true });
export function showError(box, e) { box.textContent = e?.message ?? String(e ?? ""); box.hidden = !box.textContent; }
