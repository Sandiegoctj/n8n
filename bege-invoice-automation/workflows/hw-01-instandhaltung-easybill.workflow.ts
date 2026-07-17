import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const sheetTrigger = trigger({
  type: 'n8n-nodes-base.googleSheetsTrigger',
  version: 1,
  config: {
    name: 'Formular-Trigger (Sheets)',
    position: [-660, 300],
    parameters: {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      documentId: { __rl: true, mode: 'list', value: '16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU', cachedResultName: 'Checkliste Instandhaltung – Bege Apartments (Antworten)', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU/edit' },
      sheetName: { __rl: true, mode: 'list', value: 1207695698, cachedResultName: 'Formularantworten 1', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU/edit#gid=1207695698' },
      event: 'rowAdded',
      options: { valueRender: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }
    },
    credentials: { googleSheetsTriggerOAuth2Api: { id: '1eFyqJ3nNHYgDX17', name: 'Google Sheets Trigger account 3' } }
  },
  output: [{ 'Zeitstempel': '17.07.2026 10:15:00', 'Datum des Einsatzes': '17.07.2026', 'Einsatzort: Objekt / Adresse (Stadt + Straße  + Etage) ': 'Musterstr. 1, Musterstadt', 'Startpunkt (Adresse oder Ort)': 'Haspe', 'Gefahrene Kilometer (Zahl)': '12', 'Startzeit (z. B. 9:30)': '09:00:00', 'Endzeit (z. B. 17:00)': '10:30:00', 'Kategorie der Aufgabenmeldung ': 'Reparatur (konkreter Defekt, Austausch, Behebung)', 'Was wurde gemacht / festgestellt? ': 'Siphon getauscht', 'Beleg beigefügt? *': 'Nein', 'Unterschrift (Mitarbeiter)': 'Max Mustermann' }]
});

const normalizeCode = `
// ===== KONFIGURATION (Doku: bege-invoice-automation/config/abrechnung-konfiguration.md) =====
const CONFIG = {
  TEST_MODE: true,                          // true: Rechnung geht an TEST_CUSTOMER_ID statt an den Eigentuemer, PDF in TEST_DRIVE_FOLDER_ID
  TEST_CUSTOMER_ID: '',                     // Easybill-Kunden-ID fuer Tests (leer => alle Eintraege landen auf HOLD)
  TEST_DRIVE_FOLDER_ID: '',                 // Drive-Ordner fuer Test-PDFs (leer => completed_no_drive)
  GO_LIVE_TS: '2026-07-17T00:00:00+02:00',  // Zeilen mit Zeitstempel davor werden ignoriert (kein Alt-Backfill)
  RATE_HOUR_CENTS: 3000,                    // VERIFIZIERT 17.07.2026: 30,00 EUR/h netto (Easybill-Rechnungen 202611301/302/304/305/426, 7 Positionen konsistent)
  RATE_KM_CENTS: 45,                        // VERIFIZIERT 17.07.2026: 0,45 EUR/km netto (6 Positionen konsistent)
  MATERIAL_MARKUP_PCT: 0,                   // VERIFIZIERT: Material wird 1:1 als Sammelposition durchgereicht - greift nur, wenn das Formular eine Betragsspalte bekommt
  VAT_PERCENT: 19,                          // VERIFIZIERT: 19% auf allen Positionen
  REQUIRE_RECEIPT_FOR_MATERIAL: true,       // Materialbetrag > 0 ohne Beleg-Upload => HOLD
  SELF_OWNER_IDS: ['698cae5ad4b3a26bd8501a83'], // Bege Apartments GmbH (Eigenbestand) => status skipped_internal, keine Rechnung, kein Mail-Alarm
  MAX_HOURS: 16, MAX_KM: 400, MAX_MATERIAL_CENTS: 200000, MAX_TOTAL_CENTS: 500000,
  TENANT_ID: '51573283-ea96-4b74-bf32-7e0ecde3d807',
  ALERT_EMAIL: 'info@hostautomation.de',
  // Kandidaten werden erst exakt, dann als Prefix gegen die normalisierten Spaltenueberschriften gematcht
  COLUMN_MAP: {
    submitted_at: ['zeitstempel','timestamp'],
    einsatz_datum: ['datum des einsatzes','datum'],
    object_reference: ['einsatzort','objekt','wohnung','apartment','listing'],
    startzeit: ['startzeit'],
    endzeit: ['endzeit'],
    stunden_direkt: ['stunden','arbeitsstunden','arbeitszeit (stunden)','zeitaufwand'],
    kilometer: ['gefahrene kilometer','kilometer','gefahrene km','km'],
    material: ['materialkosten','material (eur)','materialkosten (eur)','material in eur'],
    kategorie: ['kategorie'],
    beschreibung: ['was wurde gemacht','beschreibung','taetigkeit','arbeitsbeschreibung'],
    beleg_ja: ['beleg beigefuegt'],
    click_collect: ['click & collect','click und collect'],
    beleg_upload: ['beleg-upload','beleg upload','beleg hochladen'],
    foto_upload: ['foto-upload','foto upload'],
    hausmeister: ['unterschrift','hausmeister','mitarbeiter']
  }
};
// ===== ENDE KONFIGURATION =====

function s(v){ return String(v === null || v === undefined ? '' : v).trim(); }
function key(v){ return s(v).toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/€/g,'eur').replace(/\\s+/g,' ').trim(); }

// MUSS identisch zur SQL-Funktion public.street_key() bleiben (Migration 20260717_1)!
function streetKey(v){
  let t = key(v);
  t = t.split(',')[0];
  t = t.replace(/\\(.*?\\)/g, ' ');
  t = t.replace(/[\\/+]/g, ' ');
  t = t.replace(/[^a-z0-9 .-]/g, ' ');
  t = t.replace(/\\./g, ' ').replace(/-/g, ' ').replace(/\\s+/g, ' ').trim();
  if (!t) return '';
  const name = []; let num = '';
  for (const tk of t.split(' ')){
    if (/^\\d/.test(tk)){
      if (name.length){ const m = tk.match(/^(\\d+)([a-z]?)/); num = m[1] + (m[2] || ''); break; }
    } else {
      const w = tk.replace(/(strasse|str|atr|srt)$/, '');
      if (w) name.push(w);
    }
  }
  if (!name.length || !num) return '';
  return name.join(' ') + ' ' + num;
}

function parseGermanNumber(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let t = String(v).replace(/eur|km|std|h/gi,'').replace(/[€\\s]/g,'').trim();
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\\./g,'').replace(',','.');
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

function parseClock(v){
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && isFinite(v)){ const h = (v % 1) * 24; return (v >= 0 && h >= 0 && h <= 24) ? h : null; }
  const m = String(v).trim().match(/^(\\d{1,2})[:.](\\d{2})(?::(\\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3] || '0');
  if (h > 24 || mi > 59 || se > 59) return null;
  return h + mi / 60 + se / 3600;
}

function parseKm(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let t = String(v).toLowerCase().replace(/km/g, ' ').trim();
  if (!t) return 0;
  if (!/\\d/.test(t)) return /kein/.test(t) ? 0 : NaN;
  t = t.replace(/,/g, '.');
  const nums = t.match(/\\d+(?:\\.\\d+)?/g);
  if (!nums) return NaN;
  return nums.reduce((a, b) => a + Number(b), 0);
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
  const cols = Object.keys(keyed);
  const pick = (f) => {
    for (const cand of CONFIG.COLUMN_MAP[f]){
      if (cand in keyed) return keyed[cand];
      const hit = cols.find(c => c.indexOf(cand) === 0);
      if (hit !== undefined) return keyed[hit];
    }
    return undefined;
  };
  const missing = ['submitted_at','object_reference'].filter(f => pick(f) === undefined);
  if (missing.length){
    throw new Error('HW-01 Konfigurationsfehler: Formular-Spalten nicht zuordenbar fuer [' + missing.join(', ') +
      ']. COLUMN_MAP im Node "Normalisieren + Fingerprint" anpassen. Vorhandene Spalten: ' + Object.keys(row).join(' | '));
  }
  const submittedRaw = s(pick('submitted_at'));
  const submittedAt = parseTimestamp(pick('submitted_at'));
  if (submittedAt && submittedAt < new Date(CONFIG.GO_LIVE_TS)) continue;

  const objectRef = s(pick('object_reference'));
  const einsatzAt = parseTimestamp(pick('einsatz_datum'));
  const startRaw = s(pick('startzeit'));
  const endRaw = s(pick('endzeit'));
  const startH = parseClock(pick('startzeit'));
  const endH = parseClock(pick('endzeit'));

  let stunden = NaN; let stundenQuelle = 'fehlt';
  const direkt = pick('stunden_direkt');
  if (direkt !== undefined && s(direkt) !== ''){ stunden = parseGermanNumber(direkt); stundenQuelle = 'spalte'; }
  else if (startH !== null && endH !== null){ stunden = Math.round((endH - startH) * 100) / 100; stundenQuelle = 'start_ende'; }

  const kmRaw = s(pick('kilometer'));
  const kilometer = parseKm(pick('kilometer'));

  const materialVal = pick('material');
  const materialEur = (materialVal === undefined || s(materialVal) === '') ? null : parseGermanNumber(materialVal);

  const belegJa = key(pick('beleg_ja')).indexOf('ja') === 0;
  const clickCollect = key(pick('click_collect')).indexOf('ja') === 0;
  const urls = (v) => { const r = s(v); return r ? r.split(/[,\\n\\s]+/).filter(u => u.indexOf('http') === 0) : []; };
  const belege = urls(pick('beleg_upload'));
  const fotos = urls(pick('foto_upload'));

  out.push({ json: {
    form_submission_id: [submittedRaw, key(objectRef), startRaw, endRaw, kmRaw].join('|'),
    submitted_at_iso: submittedAt ? submittedAt.toISOString() : null,
    submitted_at_raw: submittedRaw,
    einsatz_datum_iso: einsatzAt ? einsatzAt.toISOString() : null,
    hausmeister: s(pick('hausmeister')),
    object_reference: objectRef,
    _object_key: key(objectRef),
    _street_key: streetKey(objectRef),
    kategorie: s(pick('kategorie')),
    beschreibung: s(pick('beschreibung')),
    stunden: isNaN(stunden) ? null : stunden,
    stunden_quelle: stundenQuelle,
    start_raw: startRaw,
    end_raw: endRaw,
    kilometer: isNaN(kilometer) ? null : kilometer,
    kilometer_raw: kmRaw,
    material_raw: materialVal === undefined ? '' : s(materialVal),
    material_eur: (materialEur === null || isNaN(materialEur)) ? null : materialEur,
    material_cost_cents: (materialEur === null || isNaN(materialEur)) ? null : Math.round(materialEur * 100),
    material_flag: belegJa || clickCollect || belege.length > 0,
    belege_urls: belege,
    foto_urls: fotos,
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
      tableId: 'object_street_owner',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'street_key', condition: 'eq', keyValue: expr("{{ $('Normalisieren + Fingerprint').item.json._street_key }}") }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ street_key: 'muster 1', owner_id: '67d6eefbbb8161d020c3d8ef', owner_count: 1, sample_address: 'Musterstr. 1, Musterstadt' }]
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
const streetRow = $('Lookup: Objekt zu Owner').item.json || {};
const ownerRow = $('Lookup: Eigentuemer-Daten').item.json || {};
const issues = [];
// NaN wird bei der n8n-Serialisierung zu null - hier zurueck nach NaN, damit die Checks greifen
const stunden = (norm.stunden === null || norm.stunden === undefined) ? NaN : Number(norm.stunden);
const km = (norm.kilometer === null || norm.kilometer === undefined) ? NaN : Number(norm.kilometer);
const materialCents = norm.material_cost_cents;

// Eigenbestand: eindeutig gemappt auf einen SELF_OWNER (Bege selbst) => keine Rechnung, kein Alarm
const skipInternal = !!(streetRow.owner_id && Number(streetRow.owner_count) === 1 && CONFIG.SELF_OWNER_IDS.indexOf(streetRow.owner_id) !== -1);

if (!norm.submitted_at_iso) issues.push('Zeitstempel unlesbar: "' + norm.submitted_at_raw + '"');
if (!norm.object_reference) issues.push('Objekt-Referenz fehlt');
if (!norm._street_key) issues.push('Aus Einsatzort "' + norm.object_reference + '" laesst sich kein Strassen-Schluessel (Strasse + Hausnummer) bilden');
else if (!streetRow.owner_id) issues.push('Kein Eigentuemer-Mapping fuer "' + norm.object_reference + '" (street_key "' + norm._street_key + '" in object_street_map pflegen)');
else if (Number(streetRow.owner_count) > 1) issues.push('Objekt-Zuordnung mehrdeutig: street_key "' + norm._street_key + '" gehoert zu ' + streetRow.owner_count + ' Eigentuemern (object_street_map bereinigen oder praezisere Objektangabe)');
else if (!skipInternal && !ownerRow.easybill_customer_id) issues.push('easybill_customer_id fehlt fuer Eigentuemer ' + (ownerRow.owner_name || streetRow.owner_id));

if (isNaN(stunden)) issues.push('Arbeitszeit nicht ermittelbar (Startzeit "' + norm.start_raw + '", Endzeit "' + norm.end_raw + '")');
else if (stunden < 0) issues.push('Endzeit liegt vor Startzeit (' + norm.start_raw + ' - ' + norm.end_raw + ')');
else if (stunden > CONFIG.MAX_HOURS) issues.push('Stunden unplausibel: ' + stunden);
if (isNaN(km) || km < 0 || km > CONFIG.MAX_KM) issues.push('Kilometer unplausibel: "' + norm.kilometer_raw + '"');

let materialAdjCents = 0;
if (materialCents !== null && materialCents !== undefined){
  if (materialCents < 0 || materialCents > CONFIG.MAX_MATERIAL_CENTS) issues.push('Materialkosten unplausibel: ' + norm.material_eur);
  else if (materialCents > 0){
    materialAdjCents = Math.round(materialCents * (1 + CONFIG.MATERIAL_MARKUP_PCT / 100));
    if (CONFIG.REQUIRE_RECEIPT_FOR_MATERIAL && (!norm.belege_urls || norm.belege_urls.length === 0)) issues.push('Materialkosten ohne Beleg-Upload');
  }
} else if (norm.material_raw){
  issues.push('Materialkosten unlesbar: "' + norm.material_raw + '"');
} else if (norm.material_flag && !skipInternal){
  issues.push('Beleg/Materialkauf angegeben, aber das Formular hat keine Materialkosten-Betragsspalte - Betrag nicht automatisch bezifferbar. Material manuell abrechnen (Beleg: ' + ((norm.belege_urls || []).concat(norm.foto_urls || [])[0] || 'kein Upload') + ')');
}

const hoursCents = (!isNaN(stunden) && stunden > 0) ? Math.round(stunden * CONFIG.RATE_HOUR_CENTS) : 0;
const kmCents = (!isNaN(km) && km > 0) ? Math.round(km * CONFIG.RATE_KM_CENTS) : 0;
const totalCents = hoursCents + kmCents + materialAdjCents;
if (!skipInternal){
  if (totalCents <= 0) issues.push('Keine abrechenbare Position (Stunden und km sind 0 oder ungueltig)');
  if (totalCents > CONFIG.MAX_TOTAL_CENTS) issues.push('Gesamtbetrag ueber Limit: ' + (totalCents / 100).toFixed(2) + ' EUR');
}

let customerId = ownerRow.easybill_customer_id;
if (CONFIG.TEST_MODE) {
  customerId = CONFIG.TEST_CUSTOMER_ID;
  if (!customerId && !skipInternal) issues.push('TEST_MODE aktiv, aber TEST_CUSTOMER_ID leer - Konfiguration im Node "Normalisieren + Fingerprint" setzen');
}
if (customerId && isNaN(Number(customerId))) issues.push('easybill_customer_id ist nicht numerisch: ' + customerId);

let gdriveFolder = ownerRow.gdrive_folder_id || '';
if (CONFIG.TEST_MODE) gdriveFolder = CONFIG.TEST_DRIVE_FOLDER_ID || '';

const iso = norm.einsatz_datum_iso || norm.submitted_at_iso;
const datum = iso ? iso.slice(0, 10).split('-').reverse().join('.') : norm.submitted_at_raw;
const objekt = norm.object_reference;
const leistung = [norm.kategorie, norm.beschreibung].filter(Boolean).join(' - ');
const testPrefix = CONFIG.TEST_MODE ? '[TESTLAUF] ' : '';
const ebItems = [];
if (hoursCents > 0) ebItems.push({ type: 'POSITION', description: 'Hausmeister-/Handwerkerleistung am ' + datum + ' - ' + objekt + (leistung ? ' (' + leistung + ')' : ''), quantity: stunden, unit: 'Std.', single_price_net: CONFIG.RATE_HOUR_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (kmCents > 0) ebItems.push({ type: 'POSITION', description: 'Anfahrt (Kilometerpauschale) - ' + objekt, quantity: km, unit: 'km', single_price_net: CONFIG.RATE_KM_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (materialAdjCents > 0) ebItems.push({ type: 'POSITION', description: 'Materialkosten lt. Beleg - ' + objekt, quantity: 1, unit: 'pauschal', single_price_net: materialAdjCents, vat_percent: CONFIG.VAT_PERCENT });

return { json: {
  row_id: claim.id,
  form_submission_id: norm.form_submission_id,
  plausible: !skipInternal && issues.length === 0,
  skip_internal: skipInternal,
  hold_reason: skipInternal ? ('EIGENBESTAND ' + (ownerRow.owner_name || 'Bege Apartments GmbH') + ' - keine Weiterberechnung (CONFIG.SELF_OWNER_IDS)') : issues.join('; '),
  owner_id: streetRow.owner_id || null,
  owner_name: ownerRow.owner_name || '',
  street_key: norm._street_key,
  easybill_customer_id: customerId || '',
  gdrive_folder_id: gdriveFolder,
  computed_amount_cents: totalCents,
  vat_percent: CONFIG.VAT_PERCENT,
  object_reference: objekt,
  datum: datum,
  hausmeister: norm.hausmeister,
  stunden: isNaN(stunden) ? null : stunden,
  kilometer: isNaN(km) ? null : km,
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
        { fieldId: 'status', fieldValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.skip_internal ? 'skipped_internal' : 'hold' }}") },
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


const internIf = ifElse({
  version: 2.3,
  config: {
    name: 'Intern (ohne Mail-Alarm)?',
    position: [1470, 460],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr("{{ $('Berechnung + Plausibilitaet').item.json.skip_internal }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }
        ]
      }
    }
  }
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
                  .onFalse(logHold.to(internIf.onTrue(pacing).onFalse(mailHold.to(pacing))))
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
