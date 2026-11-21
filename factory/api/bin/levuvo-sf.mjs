#!/usr/bin/env node
// Levuvo SF terminal client for the internal API (until the web UI of block 3 exists).
//   levuvo-sf demo      creates a demo project with a small sample briefing and runs a real interview in the terminal
//   levuvo-sf status    lists the projects and their interview status
// Run it inside the factory container: docker compose exec factory levuvo-sf demo
import { request } from "node:http";
import { createInterface } from "node:readline/promises";

const PORT = Number(process.env.LEVUVO_SF_API_PORT ?? 3100);

export function api(method, path, body, { port = 3100 } = {}) {
  return new Promise((resolve, reject) => {
    // every changing request is JSON, even without a body (the API refuses anything else; bug seen in the first demo)
    const data = method === "GET" ? undefined : Buffer.from(JSON.stringify(body ?? {}));
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `localhost:${PORT}`, ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c)).on("end", () => {
        const isJson = /json/.test(res.headers["content-type"] ?? "");
        const v = isJson && b ? JSON.parse(b) : b;
        if (res.statusCode >= 400) return reject(new Error(v?.error ?? `HTTP ${res.statusCode}`));
        resolve(v);
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

const SAMPLE = `# Idea: club court booking

Our tennis club (about 180 members, 6 courts) books courts on a paper list in the clubhouse.
Members often come by only to find all courts taken, and the board has no overview of how the courts are used.

I would like a simple app where members can book a court for one hour, see free times on their phone and cancel.
The board should see a weekly overview. Guests may play with a member but cannot book themselves.
It has to be very easy, many members are over 60.
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Labels in the human's language (setting human_language); English otherwise. */
const LABELS = {
  de: { rec: "Empfehlung", answer: "Deine Antwort", thinking: "… denkt nach", help: "Antworte in eigenen Worten. Enter allein = Empfehlung übernehmen. Nummer = Option wählen, \"1, aber …\" = Option plus Ergänzung. p = pausieren, q = pausieren und beenden." },
  en: { rec: "Recommendation", answer: "Your answer", thinking: "… thinking", help: "Answer in your own words. Enter alone = take the recommendation. A number picks an option, \"1, but …\" = option plus a note. p = pause, q = pause and quit." },
};

/** The answer body: Enter = recommendation, "2" = option 2, "2, but …" = option 2 plus a note, anything else = text. */
export function answerBody(a, q) {
  const options = q.options ?? [];
  if (!a) return { text: q.recommendation.answer, ...(q.recommendation.option !== undefined ? { chosen_option: q.recommendation.option } : {}) };
  const m = /^(\d+)(?:,\s+(.+))?$/s.exec(a); // only "2" or "2, note": "1,5 Stunden", "2. Dezember", "2:30" stay text
  const n = m ? Number(m[1]) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return { chosen_option: n - 1, ...(m[2]?.trim() ? { text: `${options[n - 1].label} – ${m[2].trim()}` } : {}) };
  return { text: a };
}

async function demo() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const L = LABELS[String((await api("GET", "/api/settings")).human_language).slice(0, 2)] ?? LABELS.en;
  const slug = `demo-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(2)}`;
  console.log(`\nLevuvo SF demo: interview (A2) for the sample project "${slug}".`);
  console.log("The interviewer runs in its own sealed container and talks to the real model through the factory gateway.");
  console.log(`${L.help}\n`);
  await api("POST", "/api/projects", { name: `Demo ${slug}`, slug, description: "Levuvo SF demo: tennis club court booking" });
  await api("PUT", `/api/projects/${slug}/briefing`, { path: "idea.md", content_base64: Buffer.from(SAMPLE).toString("base64") });
  console.log(`Project created (private repository levuvo-sf/${slug} on the local git server), briefing uploaded (idea.md).`);
  let run = await api("POST", `/api/projects/${slug}/interview/start`);
  console.log(`Run ${run.run_id} started. The first question can take a minute.\n`);
  let lastQ = null;
  for (;;) {
    const iv = await api("GET", `/api/projects/${slug}/interview`);
    if (iv.status === "waiting_for_human" && iv.open_question && iv.open_question.id !== lastQ) {
      const q = iv.open_question;
      lastQ = q.id;
      console.log(`── ${q.id} ──────────────────────────────\n${q.finding}\n\n» ${q.decision_needed}`);
      (q.options ?? []).forEach((o, i) => console.log(`  ${i + 1}) ${o.label} – ${o.consequences}`));
      console.log(`  ${L.rec}: ${q.recommendation.answer} (${q.recommendation.reason})`);
      const a = (await rl.question(`\n${L.answer}: `)).trim();
      if (a === "p" || a === "q") {
        await api("POST", `/api/projects/${slug}/interview/pause`);
        console.log("Paused. Drafts and answers are kept.");
        if (a === "q") break;
        await rl.question("Press Enter to resume … ");
        while ((await api("GET", `/api/projects/${slug}/interview`)).status !== "paused") await sleep(1000);
        lastQ = null;
        run = await api("POST", `/api/projects/${slug}/interview/start`);
        console.log(`Resumed with a fresh run ${run.run_id}.\n`);
        continue;
      }
      await api("POST", `/api/projects/${slug}/interview/answer`, { question_id: q.id, ...answerBody(a, q) });
      console.log(`${L.thinking}\n`);
    }
    // the summary only once the run has fully ended (record, usage): finish_interview comes before the run's end
    if ((iv.status === "finished" || iv.status === "paused") && !iv.active_run) {
      const rec = await api("GET", `/api/runs/${iv.log.runs.at(-1).run_id}`);
      console.log(`\nInterview ${iv.status} (${rec.exit_reason}). Tool calls: ${rec.tool_calls}. Model: ${rec.model}, effort ${rec.effort}.`);
      const u = rec.usage;
      console.log(`Tokens: ${u.input_tokens} in, ${u.output_tokens} out, ${u.cache_read_input_tokens} cache read, ${u.cache_creation_input_tokens} cache write; estimated cost ${u.cost_is_lower_bound ? "at least " : ""}$${u.estimated_cost_usd} (estimate, price table ${u.price_table}).`);
      if (iv.status === "finished") console.log(`\n${await api("GET", `/api/projects/${slug}/interview/prd.md`)}\n${await api("GET", `/api/projects/${slug}/interview/features.md`)}`);
      else if (rec.exit_detail) console.log(`Detail: ${rec.exit_detail}`);
      break;
    }
    await sleep(1000);
  }
  rl.close();
}

async function status() {
  for (const p of await api("GET", "/api/projects")) {
    const o = await api("GET", `/api/projects/${p.slug}`);
    console.log(`${p.slug.padEnd(30)} interview: ${o.interview.status}${o.interview.open_question ? ` (waiting for ${o.interview.open_question})` : ""}`);
  }
}

const cmd = process.argv[2];
if (process.env.LEVUVO_SF_CLI_IMPORT === "1") { /* imported by a unit test: no command */ } else {
const main = cmd === "demo" ? demo : cmd === "status" ? status : null;
if (!main) { console.log("usage: levuvo-sf demo | levuvo-sf status"); process.exit(2); }
main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
