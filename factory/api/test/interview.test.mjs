import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFeatures, renderPrd, startPrompt, TOOL_NAMES } from "../src/interview.mjs";
import { askAndAnswer, setup, textOf, validator } from "./helpers.mjs";

const feature = (extra = {}) => ({ name: "Book a court", summary: "Members book a court for one hour.", priority: "must", depends_on: [], scope_ref: "Booking", source: "briefing/notes.md", ...extra });

test("exactly the six A2 tools of AGENTS.md", () => {
  assert.deepEqual(TOOL_NAMES, ["read_briefing", "tag_briefing_file", "ask_human", "update_prd_section", "update_features", "finish_interview"]);
});

test("read_briefing: inventory, text content, unreadable and blocked files are not handed out", async () => {
  const t = await setup({ "notes.md": "Tennis club idea", "secret.txt": "token SECRET here", "talk.mp4": Buffer.from("video") });
  const inv = JSON.parse(textOf(t.call("read_briefing", {})));
  assert.equal(inv.version, 3);
  assert.deepEqual(inv.files.map((f) => [f.path, f.readable]), [["briefing/notes.md", true], ["briefing/secret.txt", false], ["briefing/talk.mp4", false]]);
  assert.match(textOf(t.call("read_briefing", { path: "briefing/notes.md" })), /Tennis club idea/);
  const blocked = t.call("read_briefing", { path: "secret.txt" });
  assert.equal(blocked.isError, true);
  assert.doesNotMatch(textOf(blocked), /SECRET/);
  assert.match(textOf(t.call("read_briefing", { path: "talk.mp4" })), /cannot be read/);
  assert.equal(t.call("read_briefing", { path: "../../etc/passwd" }).isError, true);
  assert.equal(t.interview.load("demo").log.inventory_version_read, 3);
});

test("read_briefing returns images as image content", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const t = await setup({ "sketch.png": png });
  const r = t.call("read_briefing", { path: "briefing/sketch.png" });
  assert.equal(r.content[1].type, "image");
  assert.equal(r.content[1].mimeType, "image/png");
  assert.equal(r.content[1].data, png.toString("base64"));
});

test("malformed tool input is rejected (G2.1)", async () => {
  const t = await setup();
  for (const [tool, args] of [["update_prd_section", { section: 11, status: "drafted", content: "x", source: "briefing/notes.md" }],
    ["ask_human", { finding: "f", decision_needed: "d" }], ["ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" }, extra: 1 }],
    ["update_features", { features: [] }], ["finish_interview", {}], ["no_such_tool", {}]]) {
    assert.equal(t.call(tool, args).isError, true, `${tool} ${JSON.stringify(args)}`);
  }
  const r = t.call("ask_human", { finding: "f", decision_needed: "d", options: [{ label: "a", consequences: "b" }], recommendation: { option: 3, answer: "a", reason: "r" } });
  assert.match(textOf(r), /does not exist/);
});

test("nothing but read_briefing before the briefing was read", async () => {
  const t = await setup();
  const iv = t.interview.load("demo");
  delete iv.log.inventory_version_read;
  t.interview.save("demo", iv);
  assert.match(textOf(t.call("ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" } })), /Read the briefing first/);
});

test("a stale run cannot change anything", async () => {
  const t = await setup();
  const r = t.interview.call("demo", { id: "run-other1" }, "read_briefing", {});
  assert.match(textOf(r), /no longer the active run/);
});

test("sources must exist (GA2.4)", async () => {
  const t = await setup();
  assert.match(textOf(t.call("update_prd_section", { section: 1, status: "drafted", content: "x", source: "briefing/missing.md" })), /not in the briefing/);
  assert.match(textOf(t.call("update_prd_section", { section: 1, status: "drafted", content: "x", source: "my head" })), /must be/);
  assert.match(textOf(t.call("update_prd_section", { section: 1, status: "drafted", content: "x", source: "answer Q-001" })), /not an answered question/);
  assert.match(textOf(t.call("update_prd_section", { section: 1, status: "drafted", content: "x", source: "attachment briefing/x.png" })), /not an attachment of an answered question/);
  // web sources (scope review finding 3): https URL and retrieval date, format check only
  const web = (src) => t.call("update_prd_section", { section: 8, status: "drafted", content: "EAA applies.", source: src });
  assert.equal(web("briefing/notes.md; web https://eur-lex.europa.eu/eli/dir/2019/882/oj (retrieved 2026-11-21)").isError, undefined);
  for (const bad of ["web http://example.com (retrieved 2026-11-21)", "web https://example.com", "web https://example.com (2026-11-21)", "web https://exa mple.com (retrieved 2026-11-21)"]) assert.match(textOf(web(bad)), /must be/, bad);
  assert.match(textOf(web("web https://example.com (retrieved 2026-02-30)")), /invalid retrieval date/);
  assert.match(textOf(web("web https://example.com (retrieved 2999-01-01)")), /in the future/);
  assert.equal(t.call("update_prd_section", { section: 1, status: "drafted", content: "A booking app.", source: "briefing/notes.md" }).isError, undefined);
});

test("confirmed and deferred need an answered question about that section (scope finding 5)", async () => {
  const t = await setup();
  const confirm = (extra) => t.call("update_prd_section", { section: 2, status: "confirmed", content: "Paper list.", source: "briefing/notes.md", ...extra });
  assert.match(textOf(confirm({})), /needs answer_ref/);
  const r = t.call("ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" }, prd_sections: [2] });
  assert.ok(r.wait);
  assert.equal(t.interview.load("demo").status, "waiting_for_human");
  assert.match(textOf(confirm({ answer_ref: r.wait.id })), /no answer yet/);
  assert.match(textOf(t.call("ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" } })), /still open/);
  const delivered = t.interview.answer("demo", r.wait.id, { text: "Yes, correct" });
  assert.match(textOf(delivered), /Yes, correct/);
  const other = askAndAnswer(t, { prd_sections: [3] });
  assert.match(textOf(confirm({ answer_ref: other })), /did not ask about section 2/);
  assert.equal(confirm({ answer_ref: r.wait.id }).isError, undefined);
  assert.equal(t.interview.load("demo").prd[2].status, "confirmed");
});

test("answers: validated, once only, option or text", async () => {
  const t = await setup();
  const r = t.call("ask_human", { finding: "f", decision_needed: "d", options: [{ label: "Hourly", consequences: "c" }, { label: "Half-hourly", consequences: "c" }], recommendation: { option: 0, answer: "Hourly", reason: "r" } });
  assert.throws(() => t.interview.answer("demo", "Q-999", { text: "x" }), /no such question/);
  assert.throws(() => t.interview.answer("demo", r.wait.id, { text: "" }), /needs text/);
  assert.throws(() => t.interview.answer("demo", r.wait.id, { chosen_option: 5 }), /does not exist/);
  assert.match(textOf(t.interview.answer("demo", r.wait.id, { chosen_option: 1 })), /Half-hourly/);
  assert.throws(() => t.interview.answer("demo", r.wait.id, { text: "again" }), /already answered/);
  const e = t.interview.load("demo").log.entries[0];
  assert.equal(e.answer.chosen_option, 1);
  assert.equal(e.question.language, "de");
  assert.equal(validator.check("log", t.interview.load("demo").log), null);
});

test("an answer after the run ended is stored for the next run", async () => {
  const t = await setup();
  const r = t.call("ask_human", { finding: "f", decision_needed: "Who books?", recommendation: { answer: "Members", reason: "r" } });
  const iv = t.interview.load("demo");
  iv.status = "paused"; iv.active_run = null;
  t.interview.save("demo", iv);
  assert.equal(t.interview.answer("demo", r.wait.id, { text: "Only members" }), null);
  const after = t.interview.load("demo");
  assert.equal(after.open_question, null);
  const prompt = startPrompt({ project: { name: "Demo", slug: "demo" }, iv: after, inventory: t.briefing.inventory("demo"), lang: "de" });
  assert.match(prompt, /mode: resume/);
  assert.match(prompt, /Who books\? → answer: Only members/);
});

test("features: IDs and status set by the factory, references checked (GA3.3, GA3.5)", async () => {
  const t = await setup();
  assert.match(textOf(t.call("update_features", { features: [feature({ id: "F-007" })] })), /does not exist/);
  assert.match(textOf(t.call("update_features", { features: [feature(), feature()] })), /used twice/);
  const saved = JSON.parse(textOf(t.call("update_features", { features: [feature(), feature({ name: "Cancel" })] })));
  assert.deepEqual(saved.saved.map((f) => f.id), ["F-001", "F-002"]);
  assert.match(textOf(t.call("update_features", { features: [feature({ id: "F-001", depends_on: ["F-009"] })] })), /not in the list/);
  assert.match(textOf(t.call("update_features", { features: [feature({ id: "F-001", depends_on: ["F-001"] })] })), /itself/);
  t.call("update_features", { features: [feature({ id: "F-001" }), feature({ name: "Overview", depends_on: ["F-001"] })] });
  const f = t.interview.load("demo").features;
  assert.deepEqual(f.features.map((x) => [x.id, x.status]), [["F-001", "proposed"], ["F-003", "proposed"]], "IDs are never reused");
  assert.equal(f.next_id, 4);
});

test("finish: every section settled, features, closing question after the last change (GA2.1)", async () => {
  const t = await setup();
  let r = t.call("finish_interview", { summary: "s" });
  assert.match(textOf(r), /not confirmed or deferred.*feature list is empty.*closing question/s);
  const q = askAndAnswer(t, { prd_sections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  for (let s = 1; s <= 10; s++) t.call("update_prd_section", { section: s, status: s === 10 ? "deferred" : "confirmed", content: `Section ${s}`, source: `briefing/notes.md; answer ${q}`, answer_ref: q });
  t.call("update_features", { features: [feature()] });
  assert.match(textOf(t.call("finish_interview", { summary: "s" })), /closing question/);
  askAndAnswer(t, { closing: true });
  t.call("update_prd_section", { section: 1, status: "confirmed", content: "Changed after closing", source: `answer ${q}`, answer_ref: q });
  assert.match(textOf(t.call("finish_interview", { summary: "s" })), /closing question/, "a change after the closing question needs a new one");
  askAndAnswer(t, { closing: true });
  r = t.call("finish_interview", { summary: "Tennis club booking." });
  assert.equal(r.isError, undefined);
  const iv = t.interview.load("demo");
  assert.equal(iv.status, "finished");
  assert.equal(validator.check("log", iv.log), null);
  const prd = renderPrd({ name: "Demo" }, iv, 1);
  assert.match(prd, /## 10 Open questions\n> Status: deferred/);
  assert.match(renderFeatures({ name: "Demo" }, iv), /\| F-001 \| Book a court/);
});

test("briefing change during the interview: outdated until the changed files are read again (GA2.3)", async () => {
  const t = await setup();
  t.call("read_briefing", {});
  await t.briefing.put("demo", "notes.md", Buffer.from("Changed: also padel courts"));
  t.interview.briefingChanged("demo", "briefing/notes.md");
  await t.briefing.put("demo", "old.md", Buffer.from("temp"));
  t.interview.briefingChanged("demo", "briefing/old.md");
  t.briefing.remove("demo", "old.md");
  t.interview.briefingChanged("demo", "briefing/old.md");
  let iv = t.interview.load("demo");
  assert.deepEqual(iv.outdated, ["briefing/notes.md", "briefing/old.md"]);
  assert.equal(iv.log.status, "outdated");
  const r = t.call("update_prd_section", { section: 1, status: "drafted", content: "x", source: "briefing/notes.md" });
  assert.match(textOf(r), /briefing changed since you read it/);
  assert.match(textOf(t.call("finish_interview", { summary: "s" })), /read these again first/);
  t.call("read_briefing", {}); // settles the deleted file
  assert.deepEqual(t.interview.load("demo").outdated, ["briefing/notes.md"]);
  assert.match(textOf(t.call("read_briefing", { path: "notes.md" })), /padel/);
  iv = t.interview.load("demo");
  assert.deepEqual(iv.outdated, []);
  assert.equal(iv.log.status, "running");
});

test("tags are metadata and do not change the inventory version", async () => {
  const t = await setup();
  const v = t.briefing.inventory("demo").version;
  assert.match(textOf(t.call("tag_briefing_file", { path: "briefing/notes.md", tag: "design-reference", note: "likes calm colours" })), /Tagged/);
  assert.equal(t.call("tag_briefing_file", { path: "briefing/none.md", tag: "design-reference", note: "x" }).isError, true);
  const inv = t.briefing.inventory("demo");
  assert.equal(inv.version, v);
  assert.deepEqual(inv.files[0].tags, [{ tag: "design-reference", note: "likes calm colours", set_by: "run-test01" }]);
});

/** Brings the interview to a finishable state: all sections confirmed from briefing/notes.md, features, closing question. */
function settleAll(t) {
  const q = askAndAnswer(t, { prd_sections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  for (let s = 1; s <= 10; s++) assert.equal(t.call("update_prd_section", { section: s, status: "confirmed", content: `S${s}`, source: `briefing/notes.md; answer ${q}`, answer_ref: q }).isError, undefined);
  assert.equal(t.call("update_features", { features: [{ name: "Book", summary: "Book a court.", priority: "must", depends_on: [], scope_ref: "Booking", source: "briefing/notes.md" }] }).isError, undefined);
  askAndAnswer(t, { closing: true });
}

test("after finish_interview every further tool call is refused (branch review finding 1)", async () => {
  const t = await setup();
  settleAll(t);
  assert.equal(t.call("finish_interview", { summary: "done" }).isError, undefined);
  assert.match(textOf(t.call("update_prd_section", { section: 1, status: "drafted", content: "changed", source: "briefing/notes.md" })), /interview is finished/);
  assert.match(textOf(t.call("update_features", { features: [{ name: "Other", summary: "x", priority: "must", depends_on: [], scope_ref: "x", source: "briefing/notes.md" }] })), /interview is finished/);
  const iv = t.interview.load("demo");
  assert.equal(iv.prd[1].content, "S1");
  assert.equal(iv.features.features[0].name, "Book");
});

test("a briefing change reopens the sections that rely on the file; re-reading alone does not settle them (branch review finding 3)", async () => {
  const t = await setup({ "notes.md": "Tennis club booking", "other.md": "Opening hours" });
  settleAll(t);
  assert.deepEqual(t.interview.finishProblems(t.interview.load("demo")), []);
  await t.briefing.put("demo", "notes.md", Buffer.from("Tennis club booking, now with guests"));
  t.interview.briefingChanged("demo", "briefing/notes.md");
  assert.equal(t.call("read_briefing", { path: "briefing/notes.md" }).isError, undefined);
  const iv = t.interview.load("demo");
  assert.deepEqual(iv.outdated, []);
  assert.equal(iv.prd[1].status, "drafted");
  assert.equal(iv.prd[1].reopened_by, "briefing/notes.md");
  const problems = t.interview.finishProblems(iv).join(" | ");
  assert.match(problems, /not confirmed or deferred/);
  assert.match(problems, /closing question/);
  assert.equal(t.call("finish_interview", { summary: "x" }).isError, true);
  // a change to a file no section relies on keeps the sections but needs a new closing question
  const t2 = await setup({ "notes.md": "Tennis club booking", "other.md": "Opening hours" });
  settleAll(t2);
  t2.interview.briefingChanged("demo", "briefing/other.md");
  t2.call("read_briefing", { path: "briefing/other.md" });
  const iv2 = t2.interview.load("demo");
  assert.equal(iv2.prd[1].status, "confirmed");
  assert.match(t2.interview.finishProblems(iv2).join(" "), /closing question/);
});

test("answer attachments must be read before finishing; reading them records the inventory version (block 3 scope finding 5)", async () => {
  const t = await setup();
  const r = t.call("ask_human", { finding: "f", decision_needed: "d", recommendation: { answer: "a", reason: "r" }, prd_sections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const screened = await t.briefing.screenAttachments(r.wait.id, [{ name: "list.md", content_base64: Buffer.from("paper list").toString("base64") }, { name: "talk.mp4", content_base64: Buffer.from("video").toString("base64") }]);
  const out = t.interview.answer("demo", r.wait.id, { text: "", attachments: screened }, () => t.briefing.storeAttachments("demo", screened));
  assert.match(textOf(out), /"path": "briefing\/answers\/Q-001\/talk\.mp4"[\s\S]*"readable": false/);
  let iv = t.interview.load("demo");
  assert.deepEqual(iv.unread_attachments, ["briefing/answers/Q-001/list.md"], "only readable files are owed");
  assert.equal(iv.log.entries[0].answer.text, "", "the attachments carry the answer");
  assert.equal(iv.log.inventory_version_read, 1);
  assert.match(t.interview.finishProblems(iv).join(";"), /read the answer attachments first: briefing\/answers\/Q-001\/list\.md/);
  assert.match(textOf(t.call("read_briefing", { path: "briefing/answers/Q-001/list.md" })), /paper list/);
  iv = t.interview.load("demo");
  assert.deepEqual(iv.unread_attachments, []);
  assert.equal(iv.log.inventory_version_read, 2);
  assert.doesNotMatch(t.interview.finishProblems(iv).join(";"), /attachments/);
  await assert.rejects(t.briefing.screenAttachments("Q-002", "x"), /list of at most 10/);
  await assert.rejects(t.briefing.screenAttachments("Q-002", [{ name: "a/b.md", content_base64: "eA==" }]), /plain name/);
  assert.throws(() => t.briefing.storeAttachments("demo", screened), /already exists/, "an attachment is never replaced");
});
