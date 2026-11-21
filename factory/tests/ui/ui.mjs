#!/usr/bin/env node
// Levuvo SF web UI test: drives the real UI in real browsers the way the owner uses it, against the test stack
// (levuvo-sf-test, real factory, real Claude CLI in the real worker container, scripted fake model API).
//   functional walk 1: Chromium, desktop 1280 px, light, German
//   functional walk 2: WebKit (Safari's engine), iPhone viewport, dark, German
//   screenshot walk:   every screen in the two other combinations (Chromium phone light, WebKit desktop dark)
// Prints one "✓"/"✗" line per check (counted by run.sh) and writes screenshots to /out.
// Usage (from run.sh): docker run --rm --network host -v <dir>:/out -e BASE=http://localhost:3998 levuvo-sf/ui-test:local
import { chromium, devices, webkit } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3998";
const OUT = process.env.OUT ?? "/out";
mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (m) => console.log(`✓ ui: ${m}`);
const bad = (m) => { console.log(`✗ ui: ${m}`); fails++; };
const check = (m, cond, detail = "") => (cond ? ok(m) : bad(`${m}${detail ? ` (${detail})` : ""}`));
const api = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

async function open(engine, { phone, dark }) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...(phone ? devices["iPhone 13"] : { viewport: { width: 1280, height: 860 } }), colorScheme: dark ? "dark" : "light", locale: "de-AT" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    // the refused secret attachment is an expected 422 the page shows as an error message
    if (/Failed to load resource: the server responded with a status of 422/.test(m.text())) return;
    // WebKit reports the style Playwright itself injects for a screenshot as a CSP refusal: not the page's doing
    if (page.shooting && /Refused to apply a stylesheet/.test(m.text())) return;
    if (m.type() === "error" || /Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  return { browser, page, problems };
}
async function snap(page, opts) {
  page.shooting = true;
  try { await page.screenshot({ caret: "initial", ...opts }); await page.waitForTimeout(150); } finally { page.shooting = false; }
}
const shot = (page, tag, name) => snap(page, { path: `${OUT}/${tag}-${name}.png` });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The owner's way through block 3 in one browser: new project → interview → answers → pause → answer with
 * attachment (resumes) → finish → properties → settings → delete. */
async function walk(engine, label, opts) {
  const tag = `${label}-${opts.phone ? "phone" : "desktop"}-${opts.dark ? "dark" : "light"}`;
  const name = `E2E UI ${label}`;
  const slug = `e2e-ui-${label}`;
  const { browser, page, problems } = await open(engine, opts);
  const T = 120_000;
  try {
    await page.goto(BASE + "/");
    check(`${tag}: the start page opens in German`, await page.getByRole("heading", { name: "Braucht dich" }).isVisible());
    await shot(page, tag, "01-inbox");

    // new project with idea text and a file
    await page.getByTestId("nav-projects").click();
    await page.getByTestId("new-project").click();
    await page.getByTestId("project-name").fill(name);
    await page.getByTestId("project-idea").fill("Unser Tennisclub (180 Mitglieder, 6 Plätze) bucht Plätze auf einer Papierliste.");
    await page.getByTestId("project-files").setInputFiles({ name: "notizen.md", mimeType: "text/markdown", buffer: Buffer.from("# Notizen\nGäste spielen mit Mitgliedern.") });
    await shot(page, tag, "02-new-project");
    await page.getByTestId("project-create").click();
    await page.getByTestId("project-title").filter({ hasText: name }).waitFor();
    const p = (await api(`/api/projects/${slug}`)).body;
    check(`${tag}: project created with idea.md and the file, web search off`, p?.briefing?.files === 2 && p.web_search === false, JSON.stringify(p));
    await shot(page, tag, "03-project-new");

    // start; the first question shows up in the project and in "Needs you"
    await page.getByTestId("start").click();
    await page.getByTestId("open-question").waitFor({ timeout: T });
    check(`${tag}: the live PRD shows the agent's draft`, await page.getByTestId("prd").getByText("Court booking").isVisible());
    await shot(page, tag, "04-project-question");
    await page.getByTestId("nav-inbox").click();
    const item = page.getByTestId("inbox-item").filter({ hasText: name });
    await item.waitFor();
    check(`${tag}: the question waits in "Needs you" with a badge`, Number(await page.getByTestId("inbox-count").textContent()) >= 1);
    await shot(page, tag, "05-inbox-question");
    await item.getByRole("link", { name: "Beantworten" }).click();
    await page.getByTestId("question-form").waitFor();
    check(`${tag}: hostile text in a question is shown as text, never run`, (await page.getByText("<img src=x", { exact: false }).count()) > 0 && !(await page.evaluate(() => window.__xss)));
    check(`${tag}: the recommended option is preselected`, await page.getByRole("radio", { name: /Ja/ }).isChecked());
    await shot(page, tag, "06-question");
    // the form survives the page refreshing around it
    await page.getByTestId("answer-note").fill("aber Buchung im Viertelstundentakt");
    await page.waitForTimeout(2500);
    check(`${tag}: typed text survives the refresh`, (await page.getByTestId("answer-note").inputValue()) === "aber Buchung im Viertelstundentakt");
    await page.getByTestId("answer-send").click();
    await page.getByTestId("project-title").waitFor();

    // second question (no options): pause instead of answering, then answer from "Needs you" with an attachment
    await page.getByTestId("open-question").filter({ hasText: "Papierliste" }).waitFor({ timeout: T });
    await page.getByTestId("pause").click();
    await page.getByTestId("start").filter({ hasText: "Fortsetzen" }).waitFor({ timeout: T });
    check(`${tag}: paused, with the reason`, await page.getByText("Von dir pausiert").first().isVisible());
    await page.getByTestId("nav-inbox").click();
    await page.getByTestId("inbox-item").filter({ hasText: "Papierliste" }).getByRole("link", { name: "Beantworten" }).click();
    await page.getByTestId("question-form").waitFor();
    check(`${tag}: a question without options offers the recommendation and an own answer`, (await page.getByRole("radio").count()) === 2);
    await page.getByRole("radio", { name: "Eigene Antwort" }).check();
    await page.getByTestId("answer-send").click();
    check(`${tag}: an own answer needs text or a file`, await page.getByRole("alert").filter({ hasText: "Bitte eine Antwort" }).isVisible());
    await page.getByTestId("answer-files").setInputFiles({ name: "keys.txt", mimeType: "text/plain", buffer: Buffer.from("aws_access_key_id = AKIAZ7Q3XK4N2TJ5WB6M") });
    await page.getByTestId("answer-send").click();
    await page.getByRole("alert").filter({ hasText: "keys.txt: blocked" }).waitFor();
    check(`${tag}: an attachment with a secret is refused with the reason, the question stays open`, (await api(`/api/projects/${slug}/interview`)).body.open_question?.id === "Q-002");
    await shot(page, tag, "07-question-refused");
    await page.getByTestId("answer-files").setInputFiles({ name: "liste.md", mimeType: "text/markdown", buffer: Buffer.from("Platz 1: Mo 9-10 Huber") });
    await page.getByTestId("answer-send").click();
    await page.getByTestId("project-title").waitFor();

    // the answer resumed the interview; the closing question comes
    await page.getByTestId("open-question").filter({ hasText: "Interview beenden" }).waitFor({ timeout: T });
    const iv = (await api(`/api/projects/${slug}/interview`)).body;
    check(`${tag}: the answer resumed the interview in a fresh run and the agent read the attachment`, iv.log.runs.length === 2 && iv.prd[2].source.includes("attachment briefing/answers/Q-002/liste.md"), JSON.stringify(iv.log.runs));
    await page.getByTestId("open-question").getByRole("link", { name: "Beantworten" }).click();
    await page.getByTestId("answer-send").click();
    await page.getByText("Interview abgeschlossen – PRD-Freigabe folgt").first().waitFor({ timeout: T });
    check(`${tag}: the interview finishes`, (await api(`/api/projects/${slug}/interview`)).body.status === "finished");
    for (const k of ["features", "briefing", "history", "runs", "props"]) await page.locator(`details[data-key=${k}] > summary`).click();
    await page.getByText("Kosten (Schätzung)").first().waitFor();
    check(`${tag}: features, briefing with the answer attachment, history and run costs are shown`, (await page.getByTestId("features").getByText("F-001 · Book a court").isVisible()) && (await page.getByTestId("briefing-list").getByText("Anhang zu Q-002").isVisible()));
    check(`${tag}: no horizontal scrolling`, await noHScroll(page));
    await snap(page, { path: `${OUT}/${tag}-08-project-finished.png`, fullPage: true });

    // properties: web search per project
    await page.getByTestId("web-search").check();
    await page.waitForTimeout(500);
    check(`${tag}: web search switched on for this project`, (await api(`/api/projects/${slug}`)).body.web_search === true);
    await page.reload();
    await page.locator("details[data-key=props] > summary").click();
    check(`${tag}: the switch shows the stored value`, await page.getByTestId("web-search").isChecked());
    await page.getByTestId("web-search").uncheck();
    await page.waitForTimeout(500);
    check(`${tag}: web search switched off again`, (await api(`/api/projects/${slug}`)).body.web_search === false);

    // settings: a number and the language
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("settings-wait").fill("9");
    await page.getByTestId("settings-save").click();
    await page.getByText("Gespeichert.").waitFor();
    check(`${tag}: a setting is saved`, (await api("/api/settings")).body.ask_human_wait_minutes === 9);
    await shot(page, tag, "09-settings");
    await page.getByTestId("settings-language").selectOption("en");
    await page.getByTestId("settings-save").click();
    await page.getByTestId("nav-inbox").filter({ hasText: "Needs you" }).waitFor();
    check(`${tag}: switching the language to English relabels the UI`, true);
    await page.getByTestId("settings-wait").fill("10");
    await page.getByTestId("settings-language").selectOption("de");
    await page.getByTestId("settings-save").click();
    await page.getByTestId("nav-inbox").filter({ hasText: "Braucht dich" }).waitFor();

    // delete the project with the typed name
    await page.goto(`${BASE}/#/p/${slug}`);
    await page.locator("details[data-key=props] > summary").click();
    await page.getByTestId("delete-project").click();
    check(`${tag}: delete stays disabled until the name is typed`, await page.getByTestId("delete-yes").isDisabled());
    await page.getByTestId("delete-confirm").fill(name);
    await shot(page, tag, "10-delete");
    await page.getByTestId("delete-yes").click();
    await page.getByTestId("project-list").waitFor();
    check(`${tag}: the project is deleted`, (await api(`/api/projects/${slug}`)).status === 404);
    check(`${tag}: no console errors and no CSP violations`, problems.length === 0, problems.join(" | ").slice(0, 300));
  } catch (e) {
    bad(`${tag}: walk stopped: ${e.message.split("\n")[0]}`);
    await snap(page, { path: `${OUT}/${tag}-failure.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

/** Every screen in one more combination, for the look check (no functional steps). */
async function screens(engine, label, opts) {
  const tag = `${label}-${opts.phone ? "phone" : "desktop"}-${opts.dark ? "dark" : "light"}`;
  const { browser, page, problems } = await open(engine, opts);
  try {
    const projects = (await api("/api/projects")).body;
    const withQ = projects.find((p) => p.interview.open_question);
    const routes = [["01-inbox", "#/"], ["02-projects", "#/projects"], ["03-new-project", "#/new"], ["04-settings", "#/settings"], ...(projects[0] ? [["05-project", `#/p/${projects[0].slug}`]] : []), ...(withQ ? [["06-question", `#/p/${withQ.slug}/q/${withQ.interview.open_question.id}`]] : [])];
    for (const [n, r] of routes) {
      await page.goto(`${BASE}/${r}`);
      await page.waitForTimeout(600);
      await shot(page, tag, n);
      if (!(await noHScroll(page))) bad(`${tag}: horizontal scrolling on ${r}`);
    }
    check(`${tag}: every screen renders without console errors`, problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally { await browser.close(); }
}

await walk(chromium, "chromium", { phone: false, dark: false });
await walk(webkit, "webkit", { phone: true, dark: true });
await screens(chromium, "chromium", { phone: true, dark: false });
await screens(webkit, "webkit", { phone: false, dark: true });
console.log(fails ? `ui: ${fails} check(s) failed` : "ui: all browser checks passed");
process.exit(fails ? 1 : 0);
