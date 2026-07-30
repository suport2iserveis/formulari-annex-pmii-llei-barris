import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const receiver = await readFile(
  new URL("../google-apps-script.gs", import.meta.url),
  "utf8",
);

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
  assert.match(html, /token:SUBMISSION_TOKEN/);
  assert.match(html, /LLB_STUDIO_REFRESH/);
  assert.doesNotMatch(html, /STUDIO_SYNC_KEY/);
});

test("mostra el municipi vinculat a la primera plana", () => {
  assert.match(html, /id="municipality-name"/);
  assert.match(html, /Municipi vinculat/);
  assert.match(html, /params\.get\("municipality"\)/);
  assert.match(html, /municipality:data\.project\.municipality/);
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
  assert.match(receiver, /createAnnexPdf_/);
  assert.match(receiver, /createSimplePdfBlob_/);
  assert.match(receiver, /application\/pdf/);
  assert.match(receiver, /sendAnnexEmail_/);
  assert.match(receiver, /moduleKey: 'annex'/);
  assert.match(receiver, /'X-Studio-Session': studioSession/);
  assert.match(receiver, /payload\.token !== LLB_CONFIG\.TOKEN/);
  assert.match(receiver, /SERVICE_VERSION: 14/);
  assert.doesNotMatch(receiver, /DocumentApp\.|DriveApp\./);
});

test("no mostra un fals error mentre l’enviament confirmat continua processant-se", () => {
  assert.match(html, /waitForSubmissionStatus = async \(submissionId, attempts = 40\)/);
  assert.match(html, /if \(result\.pending\)/);
  assert.match(html, /L’enviament s’ha transmès i continua processant-se/);
  assert.match(html, /try \{ await loadStudioVersion\(\); \} catch \{\}/);
});

test("genera un PDF binari vàlid sense serveis de Documents o Drive", () => {
  const sandbox = {
    Utilities: {
      newBlob(bytes, mimeType, fileName) {
        return { bytes, mimeType, fileName };
      },
    },
  };
  vm.runInNewContext(receiver, sandbox);
  const blob = sandbox.createSimplePdfBlob_(
    [
      { text: "ANNEX PMII · LLEI DE BARRIS", size: 18, bold: true },
      {
        text: "Municipi: Caldes de Montbui. Experiència d’acció comunitària i planificació.",
        size: 10,
      },
    ],
    "annex-prova.pdf",
  );
  const pdf = Buffer.from(blob.bytes);
  assert.equal(blob.mimeType, "application/pdf");
  assert.equal(blob.fileName, "annex-prova.pdf");
  assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(pdf.toString("latin1"), /xref[\s\S]*startxref[\s\S]*%%EOF$/);
});

test("l’script principal té sintaxi JavaScript vàlida", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});
