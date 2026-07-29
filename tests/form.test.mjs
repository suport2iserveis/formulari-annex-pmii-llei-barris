import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("conté els quatre passos i tots els camps de la proposta", () => {
  for (const text of [
    "Dades generals",
    "Planificació municipal",
    "Dades bancàries",
    "Revisió i enviament",
    "pmiiTitle",
    "aaeName",
    "urbanAgenda",
    "similarExperience",
    "iban",
  ]) assert.match(html, new RegExp(text));
});

test("conserva el contracte segur amb l’Studio", () => {
  assert.match(html, /x-studio-session/);
  assert.match(html, /integration","annex"/);
  assert.match(html, /moduleKey:"annex"/);
  assert.match(html, /LLB_STUDIO_REFRESH/);
  assert.doesNotMatch(html, /STUDIO_SYNC_KEY/);
});

test("inclou desament local, JSON, impressió i validació IBAN", () => {
  assert.match(html, /localStorage/);
  assert.match(html, /exportJson/);
  assert.match(html, /importJson/);
  assert.match(html, /window\.print/);
  assert.match(html, /remainder === 1/);
});

test("l’script principal té sintaxi JavaScript vàlida", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});
