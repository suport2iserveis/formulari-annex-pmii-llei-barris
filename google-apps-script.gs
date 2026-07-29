/**
 * Receptor del formulari acumulatiu de fitxes d'actuació de Llei de barris.
 * Desplegueu-lo com a aplicació web que s'executa amb el compte del propietari.
 */
const LLB_CONFIG = Object.freeze({
  RECIPIENT: 'suport2@iserveis.cat',
  TOKEN: 'llb-7f28dca4e9c041dfa36e2bb15c9477e2',
  SERVICE_VERSION: 12,
  MAX_ACTIONS: 150,
  MAX_XLSX_BYTES: 20 * 1024 * 1024,
  STATUS_SECONDS: 1800,
  MIN_WORKBOOK_LAYOUT_VERSION: 4,
  STUDIO_API_PROPERTY: 'STUDIO_API_URL',
  STUDIO_KEY_PROPERTY: 'STUDIO_SYNC_KEY'
});

function doGet(e) {
  const parameters = (e && e.parameter) || {};
  const statusId = cleanIdentifier_(parameters.status);
  if (statusId && parameters.token === LLB_CONFIG.TOKEN && parameters.callback) {
    const status = readStatus_(statusId) || { ok: false, pending: true, submissionId: statusId };
    return javascriptResponse_(parameters.callback, status);
  }
  return jsonResponse_({
    ok: true,
    service: 'Receptor de fitxes Llei de barris',
    serviceVersion: LLB_CONFIG.SERVICE_VERSION,
    workbookLayoutVersion: LLB_CONFIG.MIN_WORKBOOK_LAYOUT_VERSION,
    projectNameRequired: false
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let submissionId = '';
  try {
    lock.waitLock(30000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    submissionId = cleanIdentifier_(payload.submissionId) || createSubmissionId_();
    saveStatus_(submissionId, { ok: false, pending: true, submissionId: submissionId });
    if (payload.schema === 'iserveis-llb-annex-submission') {
      const annexSuccess = handleAnnexSubmission_(payload, submissionId);
      saveStatus_(submissionId, annexSuccess);
      return jsonResponse_(annexSuccess);
    }
    validatePayload_(payload);

    const project = payload.project;
    const summary = calculateSummary_(project);
    const submittedAt = payload.submittedAt || new Date().toISOString();
    const baseName = 'Fitxes_Llei_Barris_' + safeFileName_(project.municipality || submissionId);
    const xlsx = decodeXlsx_(payload.xlsx, baseName + '.xlsx');
    validateXlsxLayout_(xlsx, project.actions.length);
    const exportPayload = {
      schema: 'iserveis-llb-submission',
      version: 2,
      submissionId: submissionId,
      submittedAt: submittedAt,
      recipient: LLB_CONFIG.RECIPIENT,
      formBuild: payload.formBuild,
      workbookLayoutVersion: payload.workbookLayoutVersion,
      collaboratorSubmission: payload.collaboratorSubmission === true,
      collaboratorName: payload.collaboratorName || '',
      collaboratorVersionNumber: Number(payload.collaboratorVersionNumber || 0),
      collaboratorStudioSubmissionId: payload.collaboratorStudioSubmissionId || '',
      versionLabel: payload.versionLabel || 'Enviament fitxes Ens',
      submissionType: payload.submissionType || 'fitxes_ens',
      warningCount: Math.max(0, Math.floor(number_(payload.warningCount))),
      warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 250) : [],
      project: projectForEmailJson_(project),
      summary: summary
    };
    const json = Utilities.newBlob(
      JSON.stringify(exportPayload, null, 2),
      'application/json',
      baseName + '.json'
    );

    sendProjectEmail_(payload, summary, submissionId, submittedAt, [xlsx, json]);
    let studio;
    if (payload.collaboratorSubmission === true) {
      studio = {
        configured: true,
        matched: false,
        reason: 'collaborator_managed'
      };
    } else {
      try {
        studio = syncProjectWithStudio_(project, summary, submissionId, payload);
      } catch (studioError) {
        console.error(studioError && studioError.stack ? studioError.stack : studioError);
        studio = {
          configured: studioConfigurationPresent_(),
          matched: false,
          reason: 'sync_error',
          error: String(studioError && studioError.message ? studioError.message : studioError)
        };
      }
    }
    const success = {
      ok: true,
      pending: false,
      submissionId: submissionId,
      serviceVersion: LLB_CONFIG.SERVICE_VERSION,
      recipient: LLB_CONFIG.RECIPIENT,
      studio: studio
    };
    saveStatus_(submissionId, success);
    return jsonResponse_(success);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    const failure = {
      ok: false,
      pending: false,
      submissionId: submissionId,
      error: String(error && error.message ? error.message : error)
    };
    if (submissionId) saveStatus_(submissionId, failure);
    return jsonResponse_(failure);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function handleAnnexSubmission_(payload, submissionId) {
  if (payload.version !== 1) {
    throw new Error('La versió de l’enviament de l’Annex PMII no és compatible.');
  }
  const project = payload.project && typeof payload.project === 'object' ? payload.project : {};
  const annex = payload.annex && typeof payload.annex === 'object' ? payload.annex : {};
  const projectId = String(project.id || '').trim().slice(0, 100);
  const projectName = String(project.name || '').trim().slice(0, 180);
  const municipalityCode = normalizeMunicipalityCode_(project.municipalityCode);
  const studioApi = String(payload.studioApi || '').trim().replace(/\/+$/, '');
  const studioSession = String(payload.studioSession || '').trim().slice(0, 240);
  const iban = String(annex.iban || '').replace(/\D/g, '');
  if (!projectId || !projectName || !municipalityCode) {
    throw new Error('L’enllaç municipal no identifica correctament el projecte de l’Studio.');
  }
  if (!/^https:\/\/.+\/api\/studio$/i.test(studioApi) || !studioSession) {
    throw new Error('La connexió municipal amb l’Studio no és vàlida.');
  }
  if (!String(annex.pmiiTitle || '').trim() || !String(annex.aaeName || '').trim()) {
    throw new Error('Falten el títol del PMII o el nom de l’AAE.');
  }
  if (!/^\d{22}$/.test(iban)) {
    throw new Error('L’IBAN ha de contenir exactament 22 dígits.');
  }
  annex.iban = iban;
  annex.project = {
    id: projectId,
    name: projectName,
    municipalityCode: municipalityCode
  };
  annex.formVersion = String(payload.formBuild || annex.formVersion || '').slice(0, 30);
  annex.updatedAt = String(payload.submittedAt || new Date().toISOString());

  const studioPayload = {
    action: 'syncModule',
    projectId: projectId,
    moduleKey: 'annex',
    status: 'complet',
    itemCount: 13,
    warningCount: 0,
    summary: 'Annex PMII complet · ' + String(annex.aaeName || '').trim().slice(0, 180),
    source: 'Formulari municipal Annex PMII v' + annex.formVersion,
    data: annex,
    externalSubmissionId: submissionId,
    versionLabel: 'Annex PMII · ' + formatDateTime_(payload.submittedAt || new Date().toISOString()),
    submissionType: 'annex_pmii'
  };
  const studioResponse = UrlFetchApp.fetch(studioApi, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Studio-Session': studioSession,
      'X-Studio-Actor': 'Formulari municipal Annex PMII'
    },
    payload: JSON.stringify(studioPayload),
    muteHttpExceptions: true
  });
  const studioCode = studioResponse.getResponseCode();
  let studioResult;
  try {
    studioResult = JSON.parse(studioResponse.getContentText() || '{}');
  } catch (error) {
    throw new Error('L’Studio ha retornat una resposta no vàlida.');
  }
  if (studioCode < 200 || studioCode >= 300) {
    throw new Error(studioResult.error || 'L’Studio ha rebutjat l’Annex PMII (' + studioCode + ').');
  }

  const submittedAt = payload.submittedAt || new Date().toISOString();
  const baseName = 'Annex_PMII_' + safeFileName_(projectName || municipalityCode);
  const pdf = createAnnexPdf_(project, annex, submissionId, submittedAt, baseName + '.pdf');
  const json = Utilities.newBlob(
    JSON.stringify({
      schema: 'iserveis-llb-annex-submission',
      version: 1,
      submissionId: submissionId,
      submittedAt: submittedAt,
      project: project,
      annex: annex
    }, null, 2),
    'application/json',
    baseName + '.json'
  );
  sendAnnexEmail_(project, annex, submissionId, submittedAt, [pdf, json]);
  return {
    ok: true,
    pending: false,
    submissionId: submissionId,
    serviceVersion: LLB_CONFIG.SERVICE_VERSION,
    recipient: LLB_CONFIG.RECIPIENT,
    studio: studioResult
  };
}

function createAnnexPdf_(project, annex, submissionId, submittedAt, fileName) {
  const doc = DocumentApp.create('TEMP_' + safeFileName_(submissionId));
  try {
    const body = doc.getBody();
    body.appendParagraph('ANNEX PMII · LLEI DE BARRIS')
      .setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('Resum de les dades enviades a iServeis')
      .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
    body.appendTable([
      ['Identificador', submissionId],
      ['Projecte / municipi', String(project.name || '')],
      ['Codi municipal', normalizeMunicipalityCode_(project.municipalityCode)],
      ['Data i hora d’enviament', formatDateTime_(submittedAt)],
      ['Títol del PMII', String(annex.pmiiTitle || '')],
      ['Nom de l’AAE', String(annex.aaeName || '')],
      ['Agenda Urbana Local', annexYesNo_(annex.urbanAgenda)]
    ]);
    body.appendParagraph('Planificació municipal')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    const planLabels = [
      ['localHousingPlan', 'Pla local d’habitatge'],
      ['paesc', 'PAESC'],
      ['airQualityPlan', 'Pla de qualitat de l’aire'],
      ['wastePreventionPlan', 'Pla local de prevenció de residus municipals'],
      ['mobilityPlan', 'Pla de mobilitat'],
      ['sanitationMasterPlan', 'Pla director de sanejament integral'],
      ['communityActionPlan', 'Pla local d’acció comunitària inclusiva'],
      ['accessibilityPlan', 'Pla d’accessibilitat'],
      ['equalityPlan', 'Pla d’igualtat'],
      ['lgtbiProtocol', 'Protocol LGTBI']
    ];
    body.appendTable(planLabels.map(function (item) {
      return [item[1], annexYesNo_((annex.plans || {})[item[0]])];
    }));
    body.appendParagraph('Experiència en programes similars')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(String(annex.similarExperience || 'No informada.'));
    body.appendParagraph('Compte bancari')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('ES' + String(annex.iban || '').replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim());
    doc.saveAndClose();
    return DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(fileName);
  } finally {
    try {
      DriveApp.getFileById(doc.getId()).setTrashed(true);
    } catch (error) {
      console.warn('No s’ha pogut eliminar el document temporal de l’Annex PMII.');
    }
  }
}

function sendAnnexEmail_(project, annex, submissionId, submittedAt, attachments) {
  const projectName = String(project.name || project.municipality || 'Municipi').trim();
  const body = [
    'S’ha rebut el formulari municipal de l’Annex PMII.',
    '',
    'Identificador: ' + submissionId,
    'Projecte / municipi: ' + projectName,
    'Codi municipal: ' + normalizeMunicipalityCode_(project.municipalityCode),
    'Títol del PMII: ' + String(annex.pmiiTitle || ''),
    'AAE: ' + String(annex.aaeName || ''),
    'Data i hora d’enviament: ' + formatDateTime_(submittedAt),
    '',
    'S’adjunten el PDF de les dades i una còpia JSON. Les mateixes dades s’han incorporat automàticament a Documents EACAT de l’Studio.'
  ].join('\n');
  MailApp.sendEmail({
    to: LLB_CONFIG.RECIPIENT,
    subject: '[Llei de barris] ' + projectName + ' · Annex PMII',
    body: body,
    name: 'Formulari Annex PMII · iServeis',
    attachments: attachments
  });
}

function annexYesNo_(value) {
  return value === 'si' ? 'Sí' : value === 'no' ? 'No' : 'No informat';
}

function projectForEmailJson_(project) {
  const copy = JSON.parse(JSON.stringify(project));
  (copy.actions || []).forEach(function (action) {
    action.images = (Array.isArray(action.images) ? action.images : []).map(function (image) {
      const result = Object.assign({}, image);
      if (result.dataUrl) {
        result.includedInExcel = true;
        result.dataUrl = '[Imatge incorporada a la fitxa Excel]';
      }
      return result;
    });
  });
  return copy;
}

function validatePayload_(payload) {
  if (!payload || payload.token !== LLB_CONFIG.TOKEN) throw new Error('Sol·licitud no autoritzada.');
  const project = payload.project;
  if (!project || typeof project !== 'object') throw new Error('No s’han rebut les dades del projecte.');
  if (!String(project.municipality || '').trim()) throw new Error('Falta el municipi.');
  if (!Array.isArray(project.actions) || project.actions.length === 0) throw new Error('El projecte no conté actuacions.');
  if (project.actions.length > LLB_CONFIG.MAX_ACTIONS) throw new Error('El projecte supera el nombre màxim d’actuacions admès.');
  if (!payload.xlsx || !String(payload.xlsx.base64 || '').trim()) throw new Error('No s’ha rebut l’Excel del projecte.');
  if (Number(payload.workbookLayoutVersion) < LLB_CONFIG.MIN_WORKBOOK_LAYOUT_VERSION) {
    throw new Error('El formulari utilitzat és anterior a la nova fitxa Excel. Actualitza la pàgina i torna a generar l’enviament.');
  }
  if (!String(payload.formBuild || '').trim()) throw new Error('No s’ha pogut identificar la versió del formulari.');
  if (payload.collaboratorSubmission === true) {
    if (!String(payload.collaboratorName || '').trim()) {
      throw new Error('Falta identificar el col·laborador.');
    }
    if (!(Number(payload.collaboratorVersionNumber) > 0)) {
      throw new Error('Falta el número de versió del col·laborador.');
    }
    if (!String(payload.collaboratorStudioSubmissionId || '').trim()) {
      throw new Error('Falta l’identificador de l’enviament registrat a l’Studio.');
    }
  }

  const codes = Object.create(null);
  project.actions.forEach(function (action, index) {
    const prefix = 'Actuació ' + (index + 1) + ': ';
    const code = String(action.actionCode || '').trim();
    if (code && codes[code]) throw new Error(prefix + 'el codi ' + code + ' està duplicat.');
    if (code) codes[code] = true;
    if (payload.collaboratorSubmission === true) return;
    if (Array.isArray(action.years)) {
      action.years.forEach(function (year) {
        if (Number(year.other) > Number(year.total) + 0.001) {
          throw new Error(prefix + year.year + ': altres fonts superiors al cost.');
        }
      });
    }
  });
}

function calculateSummary_(project) {
  const result = {
    count: project.actions.length,
    total: 0,
    fund: 0,
    local: 0,
    other: 0,
    areas: {
      A: { count: 0, total: 0 },
      B: { count: 0, total: 0 },
      C: { count: 0, total: 0 }
    },
    years: {
      2027: { total: 0, fund: 0, local: 0, other: 0 },
      2028: { total: 0, fund: 0, local: 0, other: 0 },
      2029: { total: 0, fund: 0, local: 0, other: 0 },
      2030: { total: 0, fund: 0, local: 0, other: 0 },
      2031: { total: 0, fund: 0, local: 0, other: 0 }
    }
  };
  project.actions.forEach(function (action) {
    result.total += number_(action.actionTotal);
    result.fund += number_(action.totals && action.totals.fund);
    result.local += number_(action.totals && action.totals.local);
    result.other += number_(action.totals && action.totals.other);
    if (result.areas[action.areaCode]) {
      result.areas[action.areaCode].count += 1;
      result.areas[action.areaCode].total += number_(action.actionTotal);
    }
    (action.years || []).forEach(function (year) {
      if (!result.years[year.year]) result.years[year.year] = { total: 0, fund: 0, local: 0, other: 0 };
      result.years[year.year].total += number_(year.total);
      result.years[year.year].fund += number_(year.fund);
      result.years[year.year].local += number_(year.local);
      result.years[year.year].other += number_(year.other);
    });
  });
  return result;
}

function normalizeMunicipalityCode_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 5) return ('00000' + digits).slice(-5);
  return digits.slice(0, 5);
}

function studioConfiguration_() {
  const properties = PropertiesService.getScriptProperties();
  const rawUrl = String(properties.getProperty(LLB_CONFIG.STUDIO_API_PROPERTY) || '').trim();
  const syncKey = String(properties.getProperty(LLB_CONFIG.STUDIO_KEY_PROPERTY) || '');
  if (!rawUrl || !syncKey) return null;
  if (!/^https:\/\//i.test(rawUrl)) {
    throw new Error('STUDIO_API_URL ha de començar per https://.');
  }
  const normalizedUrl = rawUrl.replace(/\/+$/, '');
  return {
    apiUrl: /\/api\/studio$/i.test(normalizedUrl)
      ? normalizedUrl
      : normalizedUrl + '/api/studio',
    syncKey: syncKey
  };
}

function studioConfigurationPresent_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(
    String(properties.getProperty(LLB_CONFIG.STUDIO_API_PROPERTY) || '').trim() &&
    String(properties.getProperty(LLB_CONFIG.STUDIO_KEY_PROPERTY) || '')
  );
}

function syncProjectWithStudio_(project, summary, submissionId, formPayload) {
  const configuration = studioConfiguration_();
  const municipalityCode = normalizeMunicipalityCode_(project.municipalityCode);
  if (!configuration) {
    return {
      configured: false,
      matched: false,
      reason: 'not_configured',
      municipalityCode: municipalityCode
    };
  }
  if (!municipalityCode) {
    return {
      configured: true,
      matched: false,
      reason: 'invalid_code',
      municipalityCode: ''
    };
  }
  const cleanProject = JSON.parse(JSON.stringify(project));
  cleanProject.pendingStudioSubmission = null;
  cleanProject.municipalityCode = municipalityCode;
  const warningCount = Math.max(
    0,
    Math.floor(number_(formPayload && formPayload.warningCount))
  );
  const requestPayload = {
    action: 'syncFormByMunicipalityCode',
    municipalityCode: municipalityCode,
    status: warningCount ? 'avisos' : (project.actions.length ? 'complet' : 'pendent'),
    itemCount: project.actions.length,
    warningCount: warningCount,
    summary: project.actions.length + ' fitxes · ' + formatEuro_(summary.total) +
      (warningCount ? ' · ' + warningCount + ' avisos' : ''),
    source: 'Formulari públic de fitxes d’actuació',
    externalSubmissionId: submissionId,
    versionLabel: String(formPayload && formPayload.versionLabel || 'Enviament fitxes Ens').trim().slice(0, 180),
    submissionType: String(formPayload && formPayload.submissionType || 'fitxes_ens').trim().slice(0, 80),
    data: {
      actions: project.actions.length,
      budgetEur: summary.total,
      areas: {
        A: summary.areas.A.count,
        B: summary.areas.B.count,
        C: summary.areas.C.count
      },
      project: cleanProject
    }
  };
  const response = UrlFetchApp.fetch(configuration.apiUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Studio-Sync-Key': configuration.syncKey,
      'X-Studio-Actor': 'Receptor public del formulari'
    },
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  });
  const responseCode = response.getResponseCode();
  let body;
  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (error) {
    throw new Error('L’Studio ha retornat una resposta no vàlida.');
  }
  if (responseCode < 200 || responseCode >= 300) {
    throw new Error(body.error || 'L’Studio ha rebutjat la sincronització (' + responseCode + ').');
  }
  const match = body.municipalityMatch || {};
  const version = body.syncedVersion || {};
  return {
    configured: true,
    matched: match.matched === true,
    reason: match.reason || '',
    municipalityCode: municipalityCode,
    matchCount: Number(match.matchCount || 0),
    projectId: match.projectId || '',
    projectName: match.projectName || '',
    matchMethod: match.matchMethod || '',
    versionNumber: Number(version.versionNumber || 0),
    duplicate: version.duplicate === true
  };
}

function comprovaConnexioStudio() {
  const configuration = studioConfiguration_();
  if (!configuration) {
    throw new Error('Configura STUDIO_API_URL i STUDIO_SYNC_KEY a les propietats de l’script.');
  }
  const response = UrlFetchApp.fetch(
    configuration.apiUrl + '?integration=projects',
    {
      method: 'get',
      headers: { 'X-Studio-Sync-Key': configuration.syncKey },
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('L’Studio ha rebutjat la comprovació: ' + response.getContentText());
  }
  const body = JSON.parse(response.getContentText() || '{}');
  console.log('Connexió correcta. Projectes disponibles: ' + (body.projects || []).length);
  return body;
}

function decodeXlsx_(xlsxPayload, fallbackName) {
  const base64 = String(xlsxPayload && xlsxPayload.base64 || '').replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('L’Excel rebut no té un format vàlid.');
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (error) {
    throw new Error('L’Excel rebut no s’ha pogut descodificar correctament.');
  }
  if (bytes.length < 1000) throw new Error('L’Excel rebut és buit o incomplet.');
  if (bytes.length > LLB_CONFIG.MAX_XLSX_BYTES) throw new Error('L’Excel supera la mida màxima admesa.');
  const declaredSize = Number(xlsxPayload && xlsxPayload.size);
  if (!Number.isInteger(declaredSize) || declaredSize !== bytes.length) {
    throw new Error('L’Excel ha arribat incomplet. La mida rebuda no coincideix amb la generada pel formulari.');
  }
  return Utilities.newBlob(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fallbackName
  );
}

function validateXlsxLayout_(xlsxBlob, expectedActions) {
  const bytes = Array.prototype.map.call(xlsxBlob.getBytes(), function (value) { return value & 255; });
  const byName = readStoredZipEntries_(bytes);
  if (!byName['[Content_Types].xml'] || !byName['xl/workbook.xml']) {
    throw new Error('L’Excel rebut no conté l’estructura interna requerida.');
  }
  const workbookXml = zipEntryString_(bytes, byName['xl/workbook.xml']);
  ['Resum projecte', 'Pressupost anual', 'Actuacions'].forEach(function (sheetName) {
    if (workbookXml.indexOf(sheetName) < 0) throw new Error('L’Excel rebut no conté el full «' + sheetName + '».');
  });
  const actionSheets = Object.keys(byName).filter(function (name) {
    return /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
  }).filter(function (name) {
    const xml = zipEntryString_(bytes, byName[name]);
    return xml.indexOf('FITXA D’ACTUACIÓ') >= 0 &&
      xml.indexOf('Calendari, accions previstes, pressupost associat i fons de finançament') >= 0;
  });
  if (actionSheets.length !== Number(expectedActions)) {
    throw new Error('L’Excel no conté una fitxa amb la nova disposició per a cadascuna de les actuacions.');
  }
}

function zipUint16_(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function zipUint32_(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

let ZIP_CRC_TABLE_ = null;

function zipCrc32_(bytes, start, end) {
  if (!ZIP_CRC_TABLE_) {
    ZIP_CRC_TABLE_ = [];
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      ZIP_CRC_TABLE_[n] = value >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let index = start; index < end; index += 1) crc = ZIP_CRC_TABLE_[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipBytesToString_(bytes, start, end) {
  const signed = [];
  for (let index = start; index < end; index += 1) signed.push(bytes[index] > 127 ? bytes[index] - 256 : bytes[index]);
  return Utilities.newBlob(signed).getDataAsString('UTF-8');
}

function zipEntryString_(bytes, entry) {
  return zipBytesToString_(bytes, entry.start, entry.start + entry.size);
}

function readStoredZipEntries_(bytes) {
  if (!bytes || bytes.length < 22 || zipUint32_(bytes, 0) !== 0x04034B50) {
    throw new Error('L’Excel rebut no es pot obrir com un llibre .xlsx vàlid.');
  }
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (zipUint32_(bytes, offset) === 0x06054B50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('L’Excel rebut no conté el directori final del llibre.');
  const entryCount = zipUint16_(bytes, eocd + 10);
  const centralSize = zipUint32_(bytes, eocd + 12);
  const centralOffset = zipUint32_(bytes, eocd + 16);
  const commentLength = zipUint16_(bytes, eocd + 20);
  if (zipUint16_(bytes, eocd + 4) !== 0 || zipUint16_(bytes, eocd + 6) !== 0 || zipUint16_(bytes, eocd + 8) !== entryCount) {
    throw new Error('L’Excel rebut utilitza una estructura ZIP no admesa.');
  }
  if (eocd + 22 + commentLength !== bytes.length || centralOffset + centralSize !== eocd) {
    throw new Error('L’Excel rebut és incomplet o està truncat.');
  }
  const entries = Object.create(null);
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || zipUint32_(bytes, cursor) !== 0x02014B50) {
      throw new Error('El directori intern de l’Excel rebut no és vàlid.');
    }
    const flags = zipUint16_(bytes, cursor + 8);
    const method = zipUint16_(bytes, cursor + 10);
    const checksum = zipUint32_(bytes, cursor + 16);
    const compressedSize = zipUint32_(bytes, cursor + 20);
    const uncompressedSize = zipUint32_(bytes, cursor + 24);
    const nameLength = zipUint16_(bytes, cursor + 28);
    const extraLength = zipUint16_(bytes, cursor + 30);
    const centralCommentLength = zipUint16_(bytes, cursor + 32);
    const localOffset = zipUint32_(bytes, cursor + 42);
    const centralEnd = cursor + 46 + nameLength + extraLength + centralCommentLength;
    if (centralEnd > eocd || flags & 1 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error('L’Excel rebut conté un component ZIP no admès.');
    }
    const name = zipBytesToString_(bytes, cursor + 46, cursor + 46 + nameLength);
    if (!name || entries[name]) throw new Error('L’Excel rebut conté components duplicats o sense nom.');
    if (localOffset + 30 > centralOffset || zipUint32_(bytes, localOffset) !== 0x04034B50) {
      throw new Error('L’Excel rebut conté una capçalera interna no vàlida.');
    }
    const localNameLength = zipUint16_(bytes, localOffset + 26);
    const localExtraLength = zipUint16_(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (zipUint16_(bytes, localOffset + 8) !== method || dataEnd > centralOffset || zipCrc32_(bytes, dataStart, dataEnd) !== checksum) {
      throw new Error('L’Excel rebut no supera la comprovació d’integritat.');
    }
    entries[name] = { start: dataStart, size: uncompressedSize };
    cursor = centralEnd;
  }
  if (cursor !== eocd) throw new Error('El directori intern de l’Excel rebut és incomplet.');
  return entries;
}

function statusKey_(submissionId) {
  return 'llb-status-' + submissionId;
}

function saveStatus_(submissionId, status) {
  const storedStatus = Object.assign({}, status, { savedAt: Date.now() });
  const serialized = JSON.stringify(storedStatus);
  try {
    CacheService.getScriptCache().put(statusKey_(submissionId), serialized, LLB_CONFIG.STATUS_SECONDS);
  } catch (error) {
    console.error('No s’ha pogut desar l’estat de l’enviament: ' + error);
  }
  try {
    PropertiesService.getScriptProperties().setProperty(statusKey_(submissionId), serialized);
  } catch (error) {
    console.error('No s’ha pogut desar l’estat persistent de l’enviament: ' + error);
  }
}

function readStatus_(submissionId) {
  const key = statusKey_(submissionId);
  let stored = '';
  try {
    stored = CacheService.getScriptCache().get(key) || '';
  } catch (error) {
    console.error('No s’ha pogut llegir la memòria cau de l’enviament: ' + error);
  }
  if (!stored) {
    try {
      stored = PropertiesService.getScriptProperties().getProperty(key) || '';
    } catch (error) {
      console.error('No s’ha pogut llegir l’estat persistent de l’enviament: ' + error);
    }
  }
  if (!stored) return null;
  try {
    const status = JSON.parse(stored);
    if (status.savedAt && Date.now() - Number(status.savedAt) > LLB_CONFIG.STATUS_SECONDS * 1000) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      return null;
    }
    return status;
  } catch (error) {
    return null;
  }
}

function javascriptResponse_(callback, payload) {
  const safeCallback = String(callback || '').replace(/[^a-zA-Z0-9_$]/g, '').slice(0, 100);
  if (!safeCallback) return jsonResponse_(payload);
  return ContentService
    .createTextOutput(safeCallback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function sendProjectEmail_(payload, summary, submissionId, submittedAt, attachments) {
  const project = payload.project;
  const isCollaborator = payload.collaboratorSubmission === true;
  const collaboratorName = String(payload.collaboratorName || '').trim();
  const collaboratorVersion = Math.max(1, Math.floor(number_(payload.collaboratorVersionNumber)));
  const versionLabel = String(payload.versionLabel || 'Enviament fitxes Ens').trim();
  const warningCount = Math.max(0, Math.floor(number_(payload.warningCount)));
  const submittedAtFormatted = formatDateTime_(submittedAt);
  const subject = isCollaborator
    ? project.municipality + ' + enviament col·laborador ' + collaboratorName + ' + versió ' + collaboratorVersion
    : '[Llei de barris] ' + project.municipality + ' · ' + versionLabel;
  const body = [
    isCollaborator
      ? 'S’ha rebut una versió de fitxes enviada per un col·laborador.'
      : 'S’ha rebut un projecte de fitxes d’actuació.',
    '',
    'Identificador: ' + submissionId,
    'Municipi: ' + project.municipality,
    'Codi municipal: ' + (normalizeMunicipalityCode_(project.municipalityCode) || 'No informat'),
    isCollaborator ? 'Col·laborador: ' + collaboratorName : '',
    isCollaborator ? 'Versió del col·laborador: ' + collaboratorVersion : '',
    !isCollaborator ? 'Nom de la versió: ' + versionLabel : '',
    !isCollaborator ? 'Avisos pendents: ' + warningCount : '',
    'Actuacions: ' + summary.count,
    'Pressupost total: ' + formatEuro_(summary.total),
    'Data i hora d’enviament: ' + submittedAtFormatted,
    'Format Excel: fitxa d’actuació v3',
    '',
    isCollaborator
      ? 'S’adjunten l’Excel de les fitxes assignades i la còpia JSON. L’enviament està pendent de revisió a l’Studio i no modifica la versió definitiva fins que iServeis l’aprovi.'
      : 'S’adjunten l’Excel complet i la còpia JSON editable del projecte.'
  ].filter(function (line) {
    return line !== '';
  }).join('\n');
  const htmlBody = [
    isCollaborator
      ? '<p>S’ha rebut una versió de fitxes enviada per un col·laborador.</p>'
      : '<p>S’ha rebut un projecte de fitxes d’actuació.</p>',
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">',
    '<tr><th align="left">Identificador</th><td>' + html_(submissionId) + '</td></tr>',
    '<tr><th align="left">Municipi</th><td>' + html_(project.municipality) + '</td></tr>',
    '<tr><th align="left">Codi municipal</th><td>' + html_(normalizeMunicipalityCode_(project.municipalityCode) || 'No informat') + '</td></tr>',
    isCollaborator ? '<tr><th align="left">Col·laborador</th><td>' + html_(collaboratorName) + '</td></tr>' : '',
    isCollaborator ? '<tr><th align="left">Versió del col·laborador</th><td>' + collaboratorVersion + '</td></tr>' : '',
    !isCollaborator ? '<tr><th align="left">Nom de la versió</th><td>' + html_(versionLabel) + '</td></tr>' : '',
    !isCollaborator ? '<tr><th align="left">Avisos pendents</th><td>' + warningCount + '</td></tr>' : '',
    '<tr><th align="left">Actuacions</th><td>' + summary.count + '</td></tr>',
    '<tr><th align="left">Pressupost total</th><td>' + formatEuro_(summary.total) + '</td></tr>',
    '<tr><th align="left">Data i hora d’enviament</th><td>' + html_(submittedAtFormatted) + '</td></tr>',
    '<tr><th align="left">Format Excel</th><td>Fitxa d’actuació v3</td></tr>',
    '</table>',
    isCollaborator
      ? '<p>S’adjunten l’Excel de les fitxes assignades i la còpia JSON. L’enviament està pendent de revisió a l’Studio i no modifica la versió definitiva fins que iServeis l’aprovi.</p>'
      : '<p>S’adjunten l’Excel complet i la còpia JSON editable del projecte.</p>'
  ].join('');
  MailApp.sendEmail({
    to: LLB_CONFIG.RECIPIENT,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: 'Formulari Llei de barris · iServeis',
    attachments: attachments
  });
}

function formatDateTime_(value) {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return String(value || '');
  return Utilities.formatDate(parsed, 'Europe/Madrid', 'dd/MM/yyyy HH:mm:ss');
}

function safeFileName_(value) {
  return String(value || 'projecte').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'projecte';
}

function cleanIdentifier_(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function createSubmissionId_() {
  return 'llb-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function number_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function html_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEuro_(value) {
  return Utilities.formatString('%.2f €', number_(value));
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
