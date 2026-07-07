import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const sheetTrigger = trigger({
  type: 'n8n-nodes-base.googleSheetsTrigger',
  version: 1,
  config: {
    name: 'Formular-Trigger (Sheets)',
    position: [-660, 300],
    parameters: {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      documentId: { __rl: true, mode: 'id', value: 'ERSETZEN_SHEET_DOKUMENT_ID' },
      sheetName: { __rl: true, mode: 'id', value: 'ERSETZEN_BLATT_GID' },
      event: 'rowAdded',
      options: { valueRender: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }
    },
    credentials: { googleSheetsTriggerOAuth2Api: { id: 'OKwqJAiGw70RQubX', name: 'Google Sheets Trigger account' } }
  },
  output: [{ 'Zeitstempel': '07.07.2026 10:15:00', 'Hausmeister': 'Max Mustermann', 'Objekt': 'Musterstr. 1 WE 3', 'Stunden': '1,5', 'Kilometer': '12', 'Materialkosten': '23,90', 'Beleg': 'https://drive.google.com/file/d/abc123', 'Beschreibung': 'Siphon getauscht' }]
});

const normalizeCode = `
// ===== KONFIGURATION (Doku: bege-invoice-automation/config/abrechnung-konfiguration.md) =====
const CONFIG = {
  TEST_MODE: true,                          // true: Rechnung geht an TEST_CUSTOMER_ID statt an den Eigentuemer
  TEST_CUSTOMER_ID: '',                     // Easybill-Kunden-ID fuer Tests (leer => alle Eintraege landen auf HOLD)
  GO_LIVE_TS: '2026-07-07T00:00:00+02:00',  // Zeilen mit Zeitstempel davor werden ignoriert (kein Alt-Backfill)
  RATE_HOUR_CENTS: 4500,                    // PLATZHALTER 45,00 EUR/h  – vor Go-live anhand historischer Rechnungen verifizieren!
  RATE_KM_CENTS: 50,                        // PLATZHALTER 0,50 EUR/km – vor Go-live verifizieren!
  MATERIAL_MARKUP_PCT: 0,                   // PLATZHALTER 0 = Material 1:1 – vor Go-live verifizieren!
  VAT_PERCENT: 19,                          // PLATZHALTER – vor Go-live verifizieren!
  REQUIRE_RECEIPT_FOR_MATERIAL: true,       // Material > 0 ohne Beleg => HOLD statt Rechnung
  MAX_HOURS: 16, MAX_KM: 400, MAX_MATERIAL_CENTS: 200000, MAX_TOTAL_CENTS: 500000,
  TENANT_ID: '51573283-ea96-4b74-bf32-7e0ecde3d807',
  ALERT_EMAIL: 'info@hostautomation.de',
  COLUMN_MAP: {
    submitted_at: ['zeitstempel','timestamp','datum'],
    hausmeister: ['hausmeister','name','mitarbeiter'],
    object_reference: ['objekt','wohnung','apartment','listing','objekt / wohnung','welche wohnung','welches objekt'],
    stunden: ['stunden','arbeitszeit (stunden)','arbeitsstunden','zeitaufwand (stunden)','zeitaufwand','arbeitszeit'],
    kilometer: ['kilometer','gefahrene kilometer','km','gefahrene km'],
    material: ['materialkosten','materialkosten (eur)','material (eur)','material','materialkosten in eur'],
    belege: ['beleg','belege','beleg-upload','belege (upload)','quittung','beleg hochladen'],
    beschreibung: ['beschreibung','was wurde gemacht','taetigkeit','arbeitsbeschreibung','bemerkung','was wurde repariert']
  }
};
// ===== ENDE KONFIGURATION =====

function s(v){ return String(v === null || v === undefined ? '' : v).trim(); }
function key(v){ return s(v).toLowerCase().replace(/\\u00e4/g,'ae').replace(/\\u00f6/g,'oe').replace(/\\u00fc/g,'ue').replace(/\\u20ac/g,'eur').replace(/\\s+/g,' '); }
function parseGermanNumber(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let t = String(v).replace(/eur|km|std|h/gi,'').replace(/[\\u20ac\\s]/g,'').trim();
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\\./g,'').replace(',','.');
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}
function parseTimestamp(v){
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number'){ const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d.getTime()) ? null : d; }
  const t = String(v).trim();
  const m = t.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?$/);
  if (m){
    const iso = m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0') +
      'T' + String(m[4] || '0').padStart(2,'0') + ':' + (m[5] || '00') + ':' + (m[6] || '00') + '+02:00';
    const d = new Date(iso); return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t); return isNaN(d.getTime()) ? null : d;
}

const out = [];
for (const it of $input.all()){
  const row = it.json;
  const keyed = {}; for (const k of Object.keys(row)) keyed[key(k)] = row[k];
  const pick = (f) => { for (const cand of CONFIG.COLUMN_MAP[f]){ if (cand in keyed) return keyed[cand]; } return undefined; };
  const missing = ['submitted_at','object_reference'].filter(f => pick(f) === undefined);
  if (missing.length){
    throw new Error('HW-01 Konfigurationsfehler: Formular-Spalten nicht zuordenbar fuer [' + missing.join(', ') +
      ']. COLUMN_MAP im Node "Normalisieren + Fingerprint" anpassen. Vorhandene Spalten: ' + Object.keys(row).join(' | '));
  }
  const submittedRaw = s(pick('submitted_at'));
  const submittedAt = parseTimestamp(pick('submitted_at'));
  if (submittedAt && submittedAt < new Date(CONFIG.GO_LIVE_TS)) continue;
  const objectRef = s(pick('object_reference'));
  const stunden = parseGermanNumber(pick('stunden'));
  const kilometer = parseGermanNumber(pick('kilometer'));
  const materialEur = parseGermanNumber(pick('material'));
  const belegeRaw = s(pick('belege'));
  const belege = belegeRaw ? belegeRaw.split(/[,\\n\\s]+/).filter(u => u.indexOf('http') === 0) : [];
  out.push({ json: {
    form_submission_id: [submittedRaw, key(objectRef), String(stunden), String(kilometer), String(materialEur)].join('|'),
    submitted_at_iso: submittedAt ? submittedAt.toISOString() : null,
    submitted_at_raw: submittedRaw,
    hausmeister: s(pick('hausmeister')),
    object_reference: objectRef,
    _object_key: key(objectRef),
    beschreibung: s(pick('beschreibung')),
    stunden: stunden,
    kilometer: kilometer,
    material_eur: materialEur,
    material_cost_cents: isNaN(materialEur) ? null : Math.round(materialEur * 100),
    belege_urls: belege,
    raw_row: row,
    config: CONFIG
  }});
}
return out;
`;

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalisieren + Fingerprint',
    position: [-440, 300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: normalizeCode }
  },
  output: [{ form_submission_id: '07.07.2026 10:15:00|musterstr. 1 we 3|1.5|12|23.9', submitted_at_iso: '2026-07-07T08:15:00.000Z', submitted_at_raw: '07.07.2026 10:15:00', hausmeister: 'Max Mustermann', object_reference: 'Musterstr. 1 WE 3', _object_key: 'musterstr. 1 we 3', beschreibung: 'Siphon getauscht', stunden: 1.5, kilometer: 12, material_eur: 23.9, material_cost_cents: 2390, belege_urls: ['https://drive.google.com/file/d/abc123'], raw_row: {}, config: { TEST_MODE: true, ALERT_EMAIL: 'info@hostautomation.de', TENANT_ID: '51573283-ea96-4b74-bf32-7e0ecde3d807', VAT_PERCENT: 19 } }]
});

const sib = splitInBatches({
  version: 3,
  config: { name: 'Einzeln (Rate-Limit)', position: [-220, 300], parameters: { batchSize: 1, options: {} } }
});

const claimInsert = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim: Protokoll-Insert',
    position: [40, 300],
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'maintenance_invoices',
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'tenant_id', fieldValue: expr('{{ $json.config.TENANT_ID }}') },
        { fieldId: 'form_submission_id', fieldValue: expr('{{ $json.form_submission_id }}') },
        { fieldId: 'submitted_at', fieldValue: expr('{{ $json.submitted_at_iso }}') },
        { fieldId: 'raw_payload', fieldValue: expr('{{ JSON.stringify($json.raw_row) }}') },
        { fieldId: 'hausmeister', fieldValue: expr('{{ $json.hausmeister }}') },
        { fieldId: 'object_reference', fieldValue: expr('{{ $json.object_reference }}') },
        { fieldId: 'stunden', fieldValue: expr('{{ $json.stunden }}') },
        { fieldId: 'kilometer', fieldValue: expr('{{ $json.kilometer }}') },
        { fieldId: 'material_cost_cents', fieldValue: expr('{{ $json.material_cost_cents }}') },
        { fieldId: 'belege_urls', fieldValue: expr('{{ JSON.stringify($json.belege_urls) }}') },
        { fieldId: 'status', fieldValue: 'processing' },
        { fieldId: 'is_processing', fieldValue: expr('{{ true }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', form_submission_id: '07.07.2026 10:15:00|musterstr. 1 we 3|1.5|12|23.9', status: 'processing' }]
});

const dupCheck = ifElse({
  version: 2.3,
  config: {
    name: 'Duplikat (bereits verarbeitet)?',
    position: [40, 560],
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'or',
        conditions: [
          { leftValue: expr('{{ JSON.stringify($json.error ?? {}) }}'), operator: { type: 'string', operation: 'contains' }, rightValue: 'duplicate key' },
          { leftValue: expr('{{ JSON.stringify($json.error ?? {}) }}'), operator: { type: 'string', operation: 'contains' }, rightValue: '23505' }
        ]
      }
    }
  }
});

const skipDuplicate = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Uebersprungen: Duplikat', position: [260, 640], parameters: {} },
  output: [{}]
});

const lookupMap = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lookup: Objekt zu Owner',
    position: [260, 300],
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'object_owner_map',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'object_key', condition: 'eq', keyValue: expr("{{ $('Normalisieren + Fingerprint').item.json._object_key }}") }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ object_key: 'musterstr. 1 we 3', owner_id: '698cae5ad4b3a26bd8501a83', listing_name: 'Musterstr. 1 WE 3' }]
});

const lookupOwner = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lookup: Eigentuemer-Daten',
    position: [480, 300],
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'owner_mapping_billing',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'owner_id', condition: 'eq', keyValue: expr("{{ $json.owner_id ?? '__kein_match__' }}") }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ owner_id: '698cae5ad4b3a26bd8501a83', owner_name: 'Bege Apartments GmbH', easybill_customer_id: '1234567', easybill_email: 'owner@example.com', gdrive_folder_id: '1AbCdEfGh' }]
});

const calcCode = `
const norm = $('Normalisieren + Fingerprint').item.json;
const CONFIG = norm.config;
const claim = $('Claim: Protokoll-Insert').item.json;
const ownerRow = $('Lookup: Eigentuemer-Daten').item.json || {};
const issues = [];
const stunden = Number(norm.stunden);
const km = Number(norm.kilometer);
const materialCents = norm.material_cost_cents;

if (!norm.submitted_at_iso) issues.push('Zeitstempel unlesbar: "' + norm.submitted_at_raw + '"');
if (!norm.object_reference) issues.push('Objekt-Referenz fehlt');
if (!ownerRow.owner_id) issues.push('Kein Eigentuemer-Mapping fuer Objekt "' + norm.object_reference + '" (Tabelle object_owner_map pflegen)');
else if (!ownerRow.easybill_customer_id) issues.push('easybill_customer_id fehlt fuer Eigentuemer ' + (ownerRow.owner_name || ownerRow.owner_id));
if (isNaN(stunden) || stunden < 0 || stunden > CONFIG.MAX_HOURS) issues.push('Stunden unplausibel: ' + norm.stunden);
if (isNaN(km) || km < 0 || km > CONFIG.MAX_KM) issues.push('Kilometer unplausibel: ' + norm.kilometer);
if (materialCents === null || isNaN(materialCents) || materialCents < 0 || materialCents > CONFIG.MAX_MATERIAL_CENTS) issues.push('Materialkosten unplausibel: ' + norm.material_eur);

const materialAdjCents = (materialCents && !isNaN(materialCents) && materialCents > 0) ? Math.round(materialCents * (1 + CONFIG.MATERIAL_MARKUP_PCT / 100)) : 0;
const hoursCents = (!isNaN(stunden) && stunden > 0) ? Math.round(stunden * CONFIG.RATE_HOUR_CENTS) : 0;
const kmCents = (!isNaN(km) && km > 0) ? Math.round(km * CONFIG.RATE_KM_CENTS) : 0;
const totalCents = hoursCents + kmCents + materialAdjCents;
if (totalCents <= 0) issues.push('Keine abrechenbare Position (Stunden, km und Material sind 0 oder ungueltig)');
if (totalCents > CONFIG.MAX_TOTAL_CENTS) issues.push('Gesamtbetrag ueber Limit: ' + (totalCents / 100).toFixed(2) + ' EUR');
if (CONFIG.REQUIRE_RECEIPT_FOR_MATERIAL && materialAdjCents > 0 && (!norm.belege_urls || norm.belege_urls.length === 0)) issues.push('Materialkosten ohne Beleg-Upload');

let customerId = ownerRow.easybill_customer_id;
if (CONFIG.TEST_MODE) {
  customerId = CONFIG.TEST_CUSTOMER_ID;
  if (!customerId) issues.push('TEST_MODE aktiv, aber TEST_CUSTOMER_ID leer - Konfiguration im Node "Normalisieren + Fingerprint" setzen');
}
if (customerId && isNaN(Number(customerId))) issues.push('easybill_customer_id ist nicht numerisch: ' + customerId);

const datum = norm.submitted_at_iso ? norm.submitted_at_iso.slice(0, 10).split('-').reverse().join('.') : norm.submitted_at_raw;
const objekt = norm.object_reference;
const testPrefix = CONFIG.TEST_MODE ? '[TESTLAUF] ' : '';
const ebItems = [];
if (hoursCents > 0) ebItems.push({ type: 'POSITION', description: 'Hausmeister-/Handwerkerleistung - ' + objekt + (norm.beschreibung ? ' (' + norm.beschreibung + ')' : ''), quantity: stunden, unit: 'Std.', single_price_net: CONFIG.RATE_HOUR_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (kmCents > 0) ebItems.push({ type: 'POSITION', description: 'Anfahrt (Kilometerpauschale) - ' + objekt, quantity: km, unit: 'km', single_price_net: CONFIG.RATE_KM_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (materialAdjCents > 0) ebItems.push({ type: 'POSITION', description: 'Materialkosten lt. Beleg - ' + objekt, quantity: 1, unit: 'pauschal', single_price_net: materialAdjCents, vat_percent: CONFIG.VAT_PERCENT });

return { json: {
  row_id: claim.id,
  form_submission_id: norm.form_submission_id,
  plausible: issues.length === 0,
  hold_reason: issues.join('; '),
  owner_id: ownerRow.owner_id || null,
  owner_name: ownerRow.owner_name || '',
  easybill_customer_id: customerId || '',
  gdrive_folder_id: ownerRow.gdrive_folder_id || '',
  computed_amount_cents: totalCents,
  vat_percent: CONFIG.VAT_PERCENT,
  object_reference: objekt,
  datum: datum,
  hausmeister: norm.hausmeister,
  stunden: stunden,
  kilometer: km,
  material_eur: norm.material_eur,
  belege_urls: norm.belege_urls,
  test_mode: CONFIG.TEST_MODE,
  alert_email: CONFIG.ALERT_EMAIL,
  easybill_payload: {
    type: 'INVOICE',
    customer_id: Number(customerId) || 0,
    currency: 'EUR',
    title: testPrefix + 'Rechnung Instandhaltung',
    text_prefix: testPrefix + 'Instandhaltung ' + objekt + ' vom ' + datum + '.',
    text: 'Vielen Dank fuer Ihr Vertrauen.',
    items: ebItems
  },
  easybill_send_payload: {
    subject: testPrefix + 'Ihre Rechnung - Instandhaltung ' + objekt + ' (Bege Apartments)',
    message: 'Sehr geehrte Damen und Herren,' + String.fromCharCode(10) + String.fromCharCode(10) +
      'anbei erhalten Sie die Rechnung fuer Instandhaltungsarbeiten am Objekt ' + objekt + ' vom ' + datum + '.' +
      String.fromCharCode(10) + String.fromCharCode(10) + 'Mit freundlichen Gruessen' + String.fromCharCode(10) + 'Bege Apartments GmbH'
  }
} };
`;

const calc = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Berechnung + Plausibilitaet',
    position: [700, 300],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: calcCode }
  },
  output: [{ row_id: '00000000-0000-0000-0000-000000000001', form_submission_id: 'x|y', plausible: true, hold_reason: '', owner_id: '698cae5ad4b3a26bd8501a83', owner_name: 'Bege Apartments GmbH', easybill_customer_id: '1234567', gdrive_folder_id: '1AbCdEfGh', computed_amount_cents: 9740, vat_percent: 19, object_reference: 'Musterstr. 1 WE 3', datum: '07.07.2026', test_mode: true, alert_email: 'info@hostautomation.de', easybill_payload: { type: 'INVOICE', customer_id: 1234567, currency: 'EUR', items: [] }, easybill_send_payload: { subject: 'Ihre Rechnung', message: 'Sehr geehrte Damen und Herren' } }]
});

const logCalc = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Berechnung',
    position: [920, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.row_id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'owner_id', fieldValue: expr('{{ $json.owner_id }}') },
        { fieldId: 'easybill_customer_id', fieldValue: expr('{{ $json.easybill_customer_id }}') },
        { fieldId: 'computed_amount_cents', fieldValue: expr('{{ $json.computed_amount_cents }}') },
        { fieldId: 'vat_percent', fieldValue: expr('{{ $json.vat_percent }}') },
        { fieldId: 'raw_payload', fieldValue: expr("{{ JSON.stringify({ zeile: $('Normalisieren + Fingerprint').item.json.raw_row, easybill_payload: $json.easybill_payload, easybill_send_payload: $json.easybill_send_payload }) }}") },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'processing' }]
});

const plausibleIf = ifElse({
  version: 2.3,
  config: {
    name: 'Plausibel?',
    position: [1140, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.plausible }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }
        ]
      }
    }
  }
});

const ebCreate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Entwurf anlegen',
    position: [1360, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.easybill.de/rest/v1/documents',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr("{{ $('Berechnung + Plausibilitaet').item.json.easybill_payload }}")
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{ id: 987654, number: null, is_draft: true, customer_id: 1234567, amount: 11590 }]
});

const logCreated = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Entwurf erstellt',
    position: [1580, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'easybill_document_id', fieldValue: expr('{{ $json.id }}') },
        { fieldId: 'status', fieldValue: 'invoice_created' },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'invoice_created', easybill_document_id: '987654' }]
});

const ebDone = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Festschreiben',
    position: [1800, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'PUT',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Entwurf anlegen').item.json.id }}/done"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth'
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{ id: 987654, number: 'RE-2026-1042', is_draft: false }]
});

const logNumber = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Rechnungsnummer',
    position: [2020, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'invoice_number', fieldValue: expr('{{ $json.number }}') },
        { fieldId: 'status', fieldValue: 'sending' },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'sending', invoice_number: 'RE-2026-1042' }]
});

const ebSend = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: E-Mail-Versand',
    position: [2240, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Entwurf anlegen').item.json.id }}/send/email"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr("{{ $('Berechnung + Plausibilitaet').item.json.easybill_send_payload }}")
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{}]
});

const logSent = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Versendet',
    position: [2460, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'status', fieldValue: 'sent' },
        { fieldId: 'processed_at', fieldValue: expr('{{ $now.toISO() }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'sent' }]
});

const ebPdf = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: PDF laden',
    position: [2680, 180],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'GET',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Entwurf anlegen').item.json.id }}/pdf"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/pdf' }] },
      options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } }
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{}]
});

const driveIf = ifElse({
  version: 2.3,
  config: {
    name: 'Drive-Ordner vorhanden?',
    position: [2900, 180],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.gdrive_folder_id }}"), operator: { type: 'string', operation: 'notEmpty', singleValue: true } }
        ]
      }
    }
  }
});

const driveUpload = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Drive: PDF ablegen',
    position: [3120, 80],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'file',
      operation: 'upload',
      inputDataFieldName: 'data',
      name: expr("RE-{{ $('Easybill: Festschreiben').item.json.number }} - Instandhaltung {{ $('Berechnung + Plausibilitaet').item.json.object_reference }} - {{ $('Berechnung + Plausibilitaet').item.json.datum }}.pdf"),
      driveId: { __rl: true, mode: 'list', value: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: expr("{{ $('Berechnung + Plausibilitaet').item.json.gdrive_folder_id }}") }
    },
    credentials: { googleDriveOAuth2Api: { id: '44jUGaiTEDR0CqkJ', name: 'Google Drive host Automation' } }
  },
  output: [{ id: '1DriveFileId', name: 'RE-2026-1042.pdf' }]
});

const logCompleted = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Abgeschlossen',
    position: [3340, 80],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'pdf_drive_file_id', fieldValue: expr('{{ $json.id }}') },
        { fieldId: 'status', fieldValue: 'completed' },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'completed' }]
});

const logNoDrive = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Abgeschlossen ohne Drive',
    position: [3120, 280],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'status', fieldValue: 'completed_no_drive' },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'completed_no_drive' }]
});

const mailNoDrive = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Drive-Ordner fehlt',
    position: [3340, 280],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01: Drive-Ordner fehlt fuer {{ $('Berechnung + Plausibilitaet').item.json.owner_name }}"),
      emailType: 'text',
      message: expr("Rechnung {{ $('Easybill: Festschreiben').item.json.number }} fuer Objekt {{ $('Berechnung + Plausibilitaet').item.json.object_reference }} wurde erstellt und versendet.\n\nABER: In owner_mapping ist keine gdrive_folder_id fuer Eigentuemer {{ $('Berechnung + Plausibilitaet').item.json.owner_name }} hinterlegt - das PDF konnte nicht abgelegt werden.\n\nBitte gdrive_folder_id pflegen. Das PDF kann danach ueber Easybill (Dokument-ID {{ $('Easybill: Entwurf anlegen').item.json.id }}) nachtraeglich abgelegt werden.\n\nSupabase-Zeile: {{ $('Berechnung + Plausibilitaet').item.json.row_id }}"),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail1' }]
});

const logHold = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: HOLD',
    position: [1360, 460],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'status', fieldValue: 'hold' },
        { fieldId: 'hold_reason', fieldValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.hold_reason }}") },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'hold' }]
});

const mailHold = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Eintrag angehalten',
    position: [1580, 460],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01 ANGEHALTEN: {{ $('Berechnung + Plausibilitaet').item.json.object_reference }} - keine Rechnung erstellt"),
      emailType: 'text',
      message: expr("Ein Formular-Eintrag wurde NICHT automatisch abgerechnet (Status: hold).\n\nObjekt: {{ $('Berechnung + Plausibilitaet').item.json.object_reference }}\nHausmeister: {{ $('Berechnung + Plausibilitaet').item.json.hausmeister }}\nDatum: {{ $('Berechnung + Plausibilitaet').item.json.datum }}\nStunden: {{ $('Berechnung + Plausibilitaet').item.json.stunden }} / km: {{ $('Berechnung + Plausibilitaet').item.json.kilometer }} / Material: {{ $('Berechnung + Plausibilitaet').item.json.material_eur }} EUR\n\nGrund:\n{{ $('Berechnung + Plausibilitaet').item.json.hold_reason }}\n\nSupabase maintenance_invoices id: {{ $('Berechnung + Plausibilitaet').item.json.row_id }}\nNach Korrektur (Sheet/Mapping) kann der Eintrag ueber den Reprocess-Workflow erneut verarbeitet werden."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail2' }]
});

const logError = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: FEHLER',
    position: [2020, 620],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'form_submission_id', condition: 'eq', keyValue: expr("{{ $('Normalisieren + Fingerprint').item.json.form_submission_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'status', fieldValue: 'error' },
        { fieldId: 'error_message', fieldValue: expr('{{ JSON.stringify($json.error ?? $json).slice(0, 900) }}') },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'error' }]
});

const mailError = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Fehler-Alarm',
    position: [2240, 620],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01 FEHLER: {{ $('Normalisieren + Fingerprint').item.json.object_reference }} ({{ $('Normalisieren + Fingerprint').item.json.submitted_at_raw }})"),
      emailType: 'text',
      message: expr("Bei der automatischen Instandhaltungs-Abrechnung ist ein technischer Fehler aufgetreten.\n\nObjekt: {{ $('Normalisieren + Fingerprint').item.json.object_reference }}\nFormular-Fingerprint: {{ $('Normalisieren + Fingerprint').item.json.form_submission_id }}\n\nFehlerdetails:\n{{ JSON.stringify($json.error ?? $json).slice(0, 1500) }}\n\nDer Eintrag steht in maintenance_invoices auf status=error und kann nach Behebung ueber den Reprocess-Workflow erneut verarbeitet werden."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail3' }]
});

const pacing = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Pacing (Rate-Limit)',
    position: [3560, 460],
    parameters: { resume: 'timeInterval', amount: 30, unit: 'seconds' }
  },
  output: [{}]
});

const pollDone = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Poll abgeschlossen', position: [40, 80], parameters: {} },
  output: [{}]
});

const docsSticky = sticky(
  '## HW-01 Instandhaltung → Easybill (Bege Apartments)\n\n**Formular-Zeile → Easybill-Rechnung → E-Mail an Eigentuemer → PDF in Drive → Protokoll in Supabase (maintenance_invoices).**\n\n**SICHERHEITSZUSTAND BEI UEBERGABE:** Workflow inaktiv. TEST_MODE=true und TEST_CUSTOMER_ID leer ⇒ jede Zeile landet auf HOLD (E-Mail-Alert), es wird KEINE Rechnung erstellt, bis die Konfiguration bewusst gesetzt wird.\n\n**Konfiguration:** CONFIG-Block im Node "Normalisieren + Fingerprint" (Saetze sind PLATZHALTER — vor Go-live anhand historischer Rechnungen verifizieren!). Doku + Go-live-Checkliste: Repo `bege-invoice-automation/README.de.md`.\n\n**NIE "Execute workflow" auf diesem Live-Workflow klicken** — der manuelle Modus emittiert ALLE Sheet-Zeilen. Tests nur ueber Pin-Daten oder Test-Sheet.\n\nIdempotenz: unique form_submission_id in maintenance_invoices — Duplikate stoppen still. Altzeilen vor GO_LIVE_TS werden ignoriert.',
  [],
  { color: 3, width: 620, height: 420 }
);

export default workflow('bege-hw01-instandhaltung', 'Bege | HW-01 Instandhaltung → Easybill')
  .add(sheetTrigger)
  .to(normalize)
  .to(sib
    .onDone(pollDone)
    .onEachBatch(
      claimInsert
        .to(lookupMap
          .to(lookupOwner
            .to(calc
              .to(logCalc
                .to(plausibleIf
                  .onTrue(ebCreate
                    .to(logCreated
                      .to(ebDone
                        .to(logNumber
                          .to(ebSend
                            .to(logSent
                              .to(ebPdf
                                .to(driveIf
                                  .onTrue(driveUpload.to(logCompleted.to(pacing)))
                                  .onFalse(logNoDrive.to(mailNoDrive.to(pacing)))
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                  .onFalse(logHold.to(mailHold.to(pacing)))
                )
              )
            )
          )
        )
    )
  )
  .add(claimInsert.onError(dupCheck.onTrue(skipDuplicate.to(pacing)).onFalse(logError)))
  .add(lookupMap.onError(logError))
  .add(lookupOwner.onError(logError))
  .add(logCalc.onError(logError))
  .add(ebCreate.onError(logError))
  .add(logCreated.onError(logError))
  .add(ebDone.onError(logError))
  .add(logNumber.onError(logError))
  .add(ebSend.onError(logError))
  .add(logSent.onError(logError))
  .add(ebPdf.onError(logError))
  .add(driveUpload.onError(logError))
  .add(logNoDrive.onError(logError))
  .add(logHold.onError(logError))
  .add(logError.to(mailError.to(pacing)))
  .add(pacing.to(nextBatch(sib)))
  .add(docsSticky);
