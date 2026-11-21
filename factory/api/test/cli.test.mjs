import assert from "node:assert/strict";
import { test } from "node:test";

process.env.LEVUVO_SF_CLI_IMPORT = "1";
const { answerBody } = await import("../bin/levuvo-sf.mjs");

test("demo answers: Enter = recommendation, number = option, number plus note = option and note, else text (Peter's first demo)", () => {
  const q = { options: [{ label: "Fixed hours" }, { label: "No blocks" }], recommendation: { option: 0, answer: "Fixed hours", reason: "r" } };
  assert.deepEqual(answerBody("", q), { text: "Fixed hours", chosen_option: 0 });
  assert.deepEqual(answerBody("2", q), { chosen_option: 1 });
  assert.deepEqual(answerBody("1, aber Buchung im Viertelstundentakt möglich", q), { chosen_option: 0, text: "Fixed hours – aber Buchung im Viertelstundentakt möglich" });
  assert.deepEqual(answerBody("3, x", q), { text: "3, x" }, "no such option: plain text");
  assert.deepEqual(answerBody("Einladung per Mail und SMS", q), { text: "Einladung per Mail und SMS" });
  assert.deepEqual(answerBody("", { recommendation: { answer: "Ja", reason: "r" } }), { text: "Ja" });
});
