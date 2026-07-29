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
  assert.match(html, /iserveis-llb-annex-submission/);
  assert.match(html, /SUBMISSION_ENDPOINT/);
  assert.match(html, /requestSubmissionStatus/);
  assert.match(html, /LLB_STUDIO_REFRESH/);
  assert.doesNotMatch(html, /STUDIO_SYNC_KEY/);
});

test("inclou desament local, JSON, impressió i requisit de 22 dígits", () => {
  assert.match(html, /localStorage/);
  assert.match(html, /exportJson/);
  assert.match(html, /importJson/);
  assert.match(html, /window\.print/);
  assert.match(html, /\\d\{22\}/);
  assert.match(html, /No se’n comprovarà la validesa bancària/);
  assert.doesNotMatch(html, /remainder === 1|% 97|dígits de control/);
});

test("aplica la identitat visual d’Iserveis i Barry", () => {
  assert.match(html, /assets\/iserveis-logo\.png/);
  assert.match(html, /assets\/barry-happy\.png/);
  assert.match(html, /--barry:/);
});

test("mou l’experiència al resum de planificació i elimina la casella de versions", () => {
  assert.match(html, /review-plans[\s\S]*Experiència/);
  assert.match(html, /<h3>Compte bancari<\/h3>/);
  assert.doesNotMatch(html, /id="version-select"|id="reload-version"|Versió de partida/);
});

test("envia a iServeis amb PDF i sincronització municipal", async () => {
  assert.match(html, /Enviar a iServeis/);
  assert.match(html, /suport2@iserveis\.cat/);
  const receiver = await readFile(new URL("../google-apps-script.gs", import.meta.url), "utf8");
  assert.match(receiver, /createAnnexPdf_/);
  assert.match(receiver, /MimeType\.PDF/);
  assert.match(receiver, /sendAnnexEmail_/);
  assert.match(receiver, /moduleKey: 'annex'/);
  assert.match(receiver, /'X-Studio-Session': studioSession/);
});

test("l’script principal té sintaxi JavaScript vàlida", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});
