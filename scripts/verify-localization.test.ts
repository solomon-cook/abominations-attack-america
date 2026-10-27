import assert from "node:assert/strict";
import test from "node:test";
import { catalogFor, MESSAGE_CATALOGS, resolveLocale } from "../apps/web/src/localization.js";

test("locale resolution prefers a supported browser language and falls back safely", () => {
  assert.equal(resolveLocale(["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLocale(["en-GB"]), "en");
  assert.equal(resolveLocale(["fr-FR"]), "en");
  assert.equal(resolveLocale([]), "en");
  assert.equal(catalogFor("fr-FR"), MESSAGE_CATALOGS.en);
});

test("the English rules-practice catalog is complete and links every question to the offline reference", () => {
  const practice = MESSAGE_CATALOGS.en.practice;
  assert.equal(practice.questions.length, 15);
  const knownReferences = new Set(practice.referenceLinks.map((link) => link.href.slice("/reference.html#".length)));
  for (const question of practice.questions) {
    assert.ok(question.prompt.trim());
    assert.ok(question.explanation.trim());
    assert.ok(question.choices.length >= 2);
    assert.ok(question.answer >= 0 && question.answer < question.choices.length);
    assert.ok(knownReferences.has(question.reference), `missing result link for ${question.reference}`);
  }
  assert.equal(practice.complete(2, 15), "Practice complete · 2 of 15 correct");
  assert.equal(practice.questionProgress(1, 15), "Question 1 of 15");
});
