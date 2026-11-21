// Levuvo SF web UI: one agent question (R2 format) and the owner's answer. Options as radio buttons with the
// recommendation marked and preselected, an explicit "own answer", an optional note and attachments (G2.5).
import { fileToBase64 } from "./api.js";
import { chip, errorBox, h, icon, showError } from "./dom.js";
import { t } from "./i18n.js";

/** The answer body for the API from the form state (also used by the tests through the UI). */
export function answerBody(q, choice, note) {
  const n = note.trim();
  const opts = q.options ?? [];
  if (choice === "own") return { text: n };
  if (choice === "rec") return { text: n ? `${q.recommendation.answer} – ${n}` : q.recommendation.answer };
  const i = Number(choice);
  return { chosen_option: i, ...(n ? { text: `${opts[i].label} – ${n}` } : {}) };
}

/** The question form. `onSubmit(body)` sends it; the form stays as typed while the page refreshes around it. */
export function questionForm(q, onSubmit) {
  const opts = q.options ?? [];
  const recOpt = q.recommendation.option;
  const choices = opts.map((o, i) => ({ value: String(i), label: o.label, detail: o.consequences, rec: i === recOpt }));
  // a recommendation that is not one of the options (or a question without options) is a choice of its own
  if (recOpt === undefined || recOpt >= opts.length) choices.push({ value: "rec", label: q.recommendation.answer, detail: q.recommendation.reason, rec: true });
  choices.push({ value: "own", label: t("ownAnswer") });
  const first = choices.find((c) => c.rec)?.value ?? choices[0].value;
  const noteLabel = h("span", {}, t("note"));
  const note = h("textarea", { name: "note", rows: 3, maxLength: 7000, "data-testid": "answer-note" });
  const files = h("input", { type: "file", multiple: true, name: "files", "data-testid": "answer-files" });
  const err = errorBox();
  const send = h("button", { class: "btn primary", type: "submit", "data-testid": "answer-send" }, t("send"));
  const radios = choices.map((c) => h("label", { class: `choice${c.rec ? " rec" : ""}` },
    h("input", { type: "radio", name: "choice", value: c.value, checked: c.value === first, onchange: sync }),
    h("span", { class: "choice-text" },
      h("span", { class: "choice-label" }, c.label, c.rec ? chip(t("recommended"), "ok") : null),
      c.detail && h("span", { class: "muted" }, c.detail))));
  const form = h("form", { class: "question-form", "data-testid": "question-form" },
    h("fieldset", {}, h("legend", { class: "sr-only" }, q.decision_needed), radios),
    h("label", { class: "field" }, noteLabel, note),
    h("label", { class: "field" }, h("span", {}, icon("clip"), t("attachments")), files),
    err, h("div", { class: "actions" }, send));
  function choice() { return form.querySelector("input[name=choice]:checked")?.value ?? first; }
  function sync() { noteLabel.textContent = choice() === "own" ? t("yourAnswer") : t("note"); }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (send.disabled) return; // never twice
    showError(err, null);
    const body = answerBody(q, choice(), note.value);
    const list = [...files.files];
    if (choice() === "own" && !body.text && !list.length) return showError(err, new Error(t("needAnswer")));
    send.disabled = true;
    send.textContent = t("sending");
    try {
      if (list.length) body.attachments = await Promise.all(list.map(async (f) => ({ name: f.name, content_base64: await fileToBase64(f) })));
      await onSubmit(body);
    } catch (e) {
      showError(err, e);
      send.disabled = false;
      send.textContent = t("send");
    }
  });
  return form;
}

/** The question itself: what the agent found, the decision and the recommendation with its reason. */
export function questionHead(q) {
  return h("div", { class: "question-head" },
    h("p", { class: "finding" }, q.finding),
    h("h2", { "data-testid": "question-decision" }, q.decision_needed),
    // the reason of a recommended option; any other recommendation is a choice of its own with its reason
    Number.isInteger(q.recommendation.option) && q.recommendation.option < (q.options ?? []).length && h("p", { class: "recommendation" }, h("strong", {}, `${t("recommendation")}: `), q.recommendation.answer, h("span", { class: "muted" }, ` – ${q.recommendation.reason}`)));
}
