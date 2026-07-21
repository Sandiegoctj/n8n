import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const startManual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Abrechnungslauf (manuell)', position: [-1050, 200] },
  output: [{}]
});

const startSchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Zyklus (greift erst bei Aktivierung)',
    position: [-1050, 400],
    parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 2, triggerAtDay: [1], triggerAtHour: 6, triggerAtMinute: 0 }] } }
  },
  output: [{}]
});

const readSheet = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Sheet lesen (Werte + Farben)',
    position: [-820, 300],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: 'https://sheets.googleapis.com/v4/spreadsheets/16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsTriggerOAuth2Api',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'includeGridData', value: 'true' },
        { name: 'ranges', value: 'Formularantworten 1' },
        { name: 'fields', value: 'sheets(properties(sheetId),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))' }
      ] }
    },
    credentials: { googleSheetsTriggerOAuth2Api: { id: '1eFyqJ3nNHYgDX17', name: 'Google Sheets Trigger account 3' } }
  },
  output: [{ sheets: [{ properties: { sheetId: 1207695698 }, data: [{ rowData: [] }] }] }]
});

const extractWhiteCode = `
// Weisse (= noch nicht abgerechnete) Zeilen extrahieren. Farbig (gruen) = bereits abgerechnet => ueberspringen.
// WICHTIG: Die Sheets-API laesst Farbanteile mit Wert 0 weg ({green:1} = sattes Gruen!) => fehlender Kanal = 0, NICHT 1.
// Eine Zeile gilt nur dann als offen, wenn ALLE Formular-Zellen weiss/ungefaerbt sind (Teilfaerbung => sicherheitshalber ueberspringen).
// Verifiziert 21.07.2026 gegen das echte Sheet: 252 Zeilen => 57 weiss/offen, 195 farbig (Diagnose-Lauf 183602).
const sheets = ($json.sheets || []);
const target = sheets.find(s => s.properties && s.properties.sheetId === 1207695698) || sheets[0] || {};
const rows = ((target.data || [])[0] || {}).rowData || [];
if (!rows.length) return [];

function cellText(c){ return (c && c.formattedValue !== undefined && c.formattedValue !== null) ? String(c.formattedValue) : ''; }
function isWhite(bg){
  if (!bg) return true; // kein Format = Default weiss (auch Zebra-Hellgrau des Bandings zaehlt als weiss, da alle Kanaele > 0.92)
  const r = bg.red || 0, g = bg.green || 0, b = bg.blue || 0;
  return r > 0.92 && g > 0.92 && b > 0.92;
}

const headerCells = rows[0].values || [];
const headers = headerCells.map(cellText);
const out = [];
for (let i = 1; i < rows.length; i++){
  const cells = rows[i].values || [];
  const ts = cellText(cells[0]);
  if (!ts) continue;
  let colored = false;
  for (let c = 0; c < headers.length; c++){
    const bg = ((cells[c] || {}).effectiveFormat || {}).backgroundColor;
    if (!isWhite(bg)){ colored = true; break; }
  }
  if (colored) continue;
  const obj = { _sheet_row: i + 1 };
  for (let c = 0; c < headers.length; c++){
    if (headers[c]) obj[headers[c]] = cellText(cells[c]);
  }
  out.push({ json: obj });
}
return out;
`;

const extractWhite = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Weisse Zeilen extrahieren',
    position: [-600, 300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: extractWhiteCode }
  },
  output: [{ _sheet_row: 8, 'Zeitstempel': '08.03.2026 10:24:48', 'Datum des Einsatzes': '04.03.2026', 'Einsatzort: Objekt / Adresse (Stadt + Straße + Hausnummer + Etage)': 'Lösorter str 44 duisburg Eg', 'Startzeit (z. B. 9:30)': '07:30:00', 'Endzeit (z. B. 17:00)': '10:25:00', 'Gefahrene Kilometer (Zahl)': '72+10' }]
});

const normalizeCode = `
// ===== KONFIGURATION (Doku: bege-invoice-automation/config/abrechnung-konfiguration.md) =====
const CONFIG = {
  TEST_MODE: false,                         // LIVE-Daten; Sicherung: Nodes 'Easybill: Festschreiben' + 'E-Mail-Versand' sind deaktiviert => nur ENTWUERFE, Jonas gibt in Easybill manuell frei. Nach 5 korrekten Sammelrechnungen beide Nodes aktivieren = Vollautomatik.
  TEST_CUSTOMER_ID: '',                     // nur relevant bei TEST_MODE=true
  TEST_DRIVE_FOLDER_ID: '',                 // nur relevant bei TEST_MODE=true
  GO_LIVE_TS: '2026-01-01T00:00:00+01:00',  // v3: Auswahl laeuft ueber WEISSE Zeilen (gruen = abgerechnet) + Fingerprint-Duplikatschutz; der Zeitstempel-Cutoff ist nur noch Notbremse.
  RATE_HOUR_CENTS: 3000,                    // VERIFIZIERT 17.07.2026: 30,00 EUR/h netto (Easybill-Rechnungen 202611301/302/304/305/426, 7 Positionen konsistent)
  RATE_KM_CENTS: 45,                        // VERIFIZIERT 17.07.2026: 0,45 EUR/km netto (6 Positionen konsistent)
  MATERIAL_MARKUP_PCT: 0,                   // VERIFIZIERT: Material wird 1:1 durchgereicht (KI liest den Beleg, Netto-Betrag wird Position => Eigentuemer zahlt exakt Beleg-Brutto)
  VAT_PERCENT: 19,                          // VERIFIZIERT: 19% auf allen Positionen
  REQUIRE_RECEIPT_FOR_MATERIAL: true,
  SELF_OWNER_IDS: ['698cae5ad4b3a26bd8501a83'], // Bege Apartments GmbH (Eigenbestand) => status skipped_internal, keine Rechnung, kein Mail-Alarm
  MAX_HOURS: 16, MAX_KM: 400, MAX_MATERIAL_CENTS: 200000, MAX_TOTAL_CENTS: 500000,
  TENANT_ID: '51573283-ea96-4b74-bf32-7e0ecde3d807',
  ALERT_EMAIL: 'info@hostautomation.de',
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

// MUSS identisch zur SQL-Funktion public.street_key() bleiben (Migration street_key_matching_setup)!
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
    _sheet_row: row._sheet_row,
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
    position: [-380, 300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: normalizeCode }
  },
  output: [{ _sheet_row: 8, form_submission_id: 'x|y|z', submitted_at_iso: '2026-03-08T09:24:48.000Z', submitted_at_raw: '08.03.2026 10:24:48', object_reference: 'Lösorter str 44 duisburg Eg', _street_key: 'loesorter 44', stunden: 2.92, kilometer: 82, material_cost_cents: null, material_flag: true, belege_urls: [], foto_urls: [], raw_row: {}, config: { TEST_MODE: false, VAT_PERCENT: 19, RATE_HOUR_CENTS: 3000, RATE_KM_CENTS: 45, ALERT_EMAIL: 'info@hostautomation.de', TENANT_ID: '51573283-ea96-4b74-bf32-7e0ecde3d807', SELF_OWNER_IDS: [], MAX_MATERIAL_CENTS: 200000 } }]
});

const sib = splitInBatches({
  version: 3,
  config: { name: 'Einzeln (Vorbereitung)', position: [-160, 300], parameters: { batchSize: 1, options: {} } }
});

const claimInsert = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim: Protokoll-Insert',
    position: [80, 300],
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
        { fieldId: 'sheet_row_number', fieldValue: expr('{{ $json._sheet_row }}') },
        { fieldId: 'submitted_at', fieldValue: expr('{{ $json.submitted_at_iso }}') },
        { fieldId: 'raw_payload', fieldValue: expr('{{ JSON.stringify($json.raw_row) }}') },
        { fieldId: 'hausmeister', fieldValue: expr('{{ $json.hausmeister }}') },
        { fieldId: 'object_reference', fieldValue: expr('{{ $json.object_reference }}') },
        { fieldId: 'stunden', fieldValue: expr('{{ $json.stunden }}') },
        { fieldId: 'kilometer', fieldValue: expr('{{ $json.kilometer }}') },
        { fieldId: 'material_cost_cents', fieldValue: expr('{{ $json.material_cost_cents }}') },
        { fieldId: 'belege_urls', fieldValue: expr('{{ JSON.stringify(($json.belege_urls || []).concat($json.foto_urls || [])) }}') },
        { fieldId: 'status', fieldValue: 'processing' },
        { fieldId: 'is_processing', fieldValue: expr('{{ true }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'processing' }]
});

const dupCheck = ifElse({
  version: 2.3,
  config: {
    name: 'Duplikat (bereits verarbeitet)?',
    position: [80, 560],
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
  config: { name: 'Uebersprungen: Duplikat', position: [300, 640], parameters: {} },
  output: [{}]
});

const belegIf = ifElse({
  version: 2.3,
  config: {
    name: 'Beleg-Foto vorhanden?',
    position: [300, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr("{{ (($('Normalisieren + Fingerprint').item.json.belege_urls || []).length) + (($('Normalisieren + Fingerprint').item.json.foto_urls || []).length) }}"), operator: { type: 'number', operation: 'gt' }, rightValue: 0 }
        ]
      }
    }
  }
});

const belegParse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Beleg-Link parsen',
    position: [520, 180],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "const norm = $('Normalisieren + Fingerprint').item.json;\nconst urls = (norm.belege_urls || []).concat(norm.foto_urls || []);\nconst url = urls[0] || '';\nlet fileId = '';\nlet m = url.match(/[?&]id=([-\\w]{20,})/);\nif (!m) m = url.match(/\\/d\\/([-\\w]{20,})/);\nif (m) fileId = m[1];\nreturn { json: { beleg_url: url, beleg_file_id: fileId } };" }
  },
  output: [{ beleg_url: 'https://drive.google.com/open?id=1AbC', beleg_file_id: '1AbC' }]
});

const belegLoad = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Beleg laden (Drive)',
    position: [740, 180],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'file',
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $json.beleg_file_id }}') },
      options: { binaryPropertyName: 'data' }
    },
    credentials: { googleDriveOAuth2Api: { id: 'UcLDrnsifFXCX7iB', name: 'Ela immbilien GmbH' } }
  },
  output: [{ id: '1AbC', name: 'beleg.jpg' }]
});

const belegKi = node({
  type: '@n8n/n8n-nodes-langchain.anthropic',
  version: 1,
  config: {
    name: 'Beleg-KI: Auswerten',
    position: [960, 180],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'image',
      operation: 'analyze',
      modelId: { __rl: true, mode: 'id', value: 'claude-sonnet-5' },
      text: 'Du siehst das Foto eines Einkaufsbelegs/Kassenbons (z. B. Baumarkt). Antworte AUSSCHLIESSLICH mit einem JSON-Objekt ohne Markdown und ohne Erklaertext, exakt in dieser Form: {"lesbar": true, "gesamt_brutto_eur": 0.00, "mwst_eur": 0.00, "netto_eur": 0.00, "haendler": "...", "belegdatum": "TT.MM.JJJJ", "hinweis": ""}. gesamt_brutto_eur ist der zu zahlende Endbetrag des Belegs. mwst_eur/netto_eur nur wenn ausgewiesen, sonst null. Wenn das Bild kein Beleg ist, mehrere Belege zeigt oder der Endbetrag nicht sicher lesbar ist: lesbar=false und kurze Begruendung in hinweis.',
      inputType: 'binary',
      binaryPropertyName: 'data',
      simplify: true,
      options: { maxTokens: 1024 }
    }
  },
  output: [{ content: [{ type: 'text', text: '{"lesbar": true, "gesamt_brutto_eur": 23.9}' }] }]
});

const belegResultCode = `
const MAX_BRUTTO_EUR = 2000;
let raw = '';
const j = $json || {};
if (typeof j.content === 'string') raw = j.content;
else if (Array.isArray(j.content) && j.content[0] && j.content[0].text) raw = j.content[0].text;
else if (typeof j.text === 'string') raw = j.text;
else if (j.message && Array.isArray(j.message.content) && j.message.content[0]) raw = j.message.content[0].text || '';
else raw = JSON.stringify(j);

let parsed = null;
try {
  const m = String(raw).match(/\\{[\\s\\S]*\\}/);
  if (m) parsed = JSON.parse(m[0]);
} catch (e) { parsed = null; }

let ok = false; let nettoCents = 0; let brutto = null; let netto = null; let mwst = null; let haendler = ''; let datum = ''; let hinweis = '';
if (parsed && parsed.lesbar === true && typeof parsed.gesamt_brutto_eur === 'number' && isFinite(parsed.gesamt_brutto_eur) && parsed.gesamt_brutto_eur > 0 && parsed.gesamt_brutto_eur <= MAX_BRUTTO_EUR) {
  brutto = Math.round(parsed.gesamt_brutto_eur * 100) / 100;
  mwst = (typeof parsed.mwst_eur === 'number' && isFinite(parsed.mwst_eur) && parsed.mwst_eur >= 0 && parsed.mwst_eur < brutto) ? parsed.mwst_eur : null;
  netto = (typeof parsed.netto_eur === 'number' && isFinite(parsed.netto_eur) && parsed.netto_eur > 0 && parsed.netto_eur <= brutto) ? parsed.netto_eur : (mwst !== null ? brutto - mwst : brutto / 1.19);
  netto = Math.round(netto * 100) / 100;
  nettoCents = Math.round(netto * 100);
  haendler = String(parsed.haendler || '').slice(0, 80);
  datum = String(parsed.belegdatum || '').slice(0, 20);
  hinweis = String(parsed.hinweis || '').slice(0, 300);
  ok = nettoCents > 0;
} else {
  hinweis = parsed ? String(parsed.hinweis || 'Beleg laut KI nicht sicher lesbar').slice(0, 300) : ('Keine auswertbare KI-Antwort: ' + String(raw).slice(0, 200));
}

return { json: {
  ki_ok: ok,
  ki_material_netto_cents: nettoCents,
  ki_netto_eur: netto,
  ki_brutto_eur: brutto,
  ki_mwst_eur: mwst,
  ki_haendler: haendler,
  ki_belegdatum: datum,
  ki_hinweis: hinweis
} };
`;

const belegResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Beleg-KI: Ergebnis',
    position: [1180, 180],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: belegResultCode }
  },
  output: [{ ki_ok: true, ki_material_netto_cents: 2008, ki_netto_eur: 20.08, ki_brutto_eur: 23.9, ki_haendler: 'Bauhaus', ki_belegdatum: '04.03.2026', ki_hinweis: '' }]
});

const kiRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'KI-Zeile bauen',
    position: [1400, 180],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "const ki = $('Beleg-KI: Ergebnis').item.json;\nconst norm = $('Normalisieren + Fingerprint').item.json;\nreturn { json: {\n  'Zeitstempel': norm.submitted_at_raw,\n  'KI Material netto (EUR)': ki.ki_ok ? ki.ki_netto_eur : '',\n  'KI Beleg brutto (EUR)': ki.ki_ok ? ki.ki_brutto_eur : '',\n  'KI Haendler': ki.ki_haendler || '',\n  'KI Belegdatum': ki.ki_belegdatum || '',\n  'KI Hinweis': ki.ki_ok ? (ki.ki_hinweis || 'OK') : ('NICHT LESBAR: ' + ki.ki_hinweis)\n} };" }
  },
  output: [{ 'Zeitstempel': '08.03.2026 10:24:48', 'KI Material netto (EUR)': 20.08, 'KI Beleg brutto (EUR)': 23.9, 'KI Haendler': 'Bauhaus', 'KI Belegdatum': '04.03.2026', 'KI Hinweis': 'OK' }]
});

const kiWrite = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'KI-Werte ins Sheet',
    position: [1620, 180],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'sheet',
      operation: 'appendOrUpdate',
      documentId: { __rl: true, mode: 'id', value: '16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU' },
      sheetName: { __rl: true, mode: 'id', value: '1207695698' },
      columns: { mappingMode: 'autoMapInputData', value: null, schema: [], matchingColumns: ['Zeitstempel'] },
      options: { handlingExtraData: 'insertInNewColumn' }
    }
  },
  output: [{ updatedRows: 1 }]
});

const lookupStreet = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lookup: Objekt zu Owner',
    position: [1840, 300],
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
  output: [{ street_key: 'loesorter 44', owner_id: '67d436fdbb8161d020b37011', owner_count: 1 }]
});

const lookupOwner = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lookup: Eigentuemer-Daten',
    position: [2060, 300],
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
  output: [{ owner_id: '67d436fdbb8161d020b37011', owner_name: 'André Michel', easybill_customer_id: '1234567', gdrive_folder_id: '1AbC' }]
});

const calcCode = `
const norm = $('Normalisieren + Fingerprint').item.json;
const CONFIG = norm.config;
const claim = $('Claim: Protokoll-Insert').item.json;
const streetRow = $('Lookup: Objekt zu Owner').item.json || {};
const ownerRow = $('Lookup: Eigentuemer-Daten').item.json || {};
const issues = [];
const stunden = (norm.stunden === null || norm.stunden === undefined) ? NaN : Number(norm.stunden);
const km = (norm.kilometer === null || norm.kilometer === undefined) ? NaN : Number(norm.kilometer);
const materialCents = norm.material_cost_cents;

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
let materialHaendler = '';
let materialBelegdatum = '';
let materialQuelle = '';
if (materialCents !== null && materialCents !== undefined){
  if (materialCents < 0 || materialCents > CONFIG.MAX_MATERIAL_CENTS) issues.push('Materialkosten unplausibel: ' + norm.material_eur);
  else if (materialCents > 0){
    materialAdjCents = Math.round(materialCents * (1 + CONFIG.MATERIAL_MARKUP_PCT / 100));
    materialQuelle = 'spalte';
    if (CONFIG.REQUIRE_RECEIPT_FOR_MATERIAL && (!norm.belege_urls || norm.belege_urls.length === 0) && (!norm.foto_urls || norm.foto_urls.length === 0)) issues.push('Materialkosten ohne Beleg-Upload');
  }
} else if (norm.material_raw){
  issues.push('Materialkosten unlesbar: "' + norm.material_raw + '"');
} else if (norm.material_flag && !skipInternal){
  let ki = null; try { ki = $('Beleg-KI: Ergebnis').item.json; } catch (e) {}
  if (ki && ki.ki_ok && ki.ki_material_netto_cents > 0 && ki.ki_material_netto_cents <= CONFIG.MAX_MATERIAL_CENTS){
    materialAdjCents = Math.round(ki.ki_material_netto_cents * (1 + CONFIG.MATERIAL_MARKUP_PCT / 100));
    materialQuelle = 'beleg_ki';
    materialHaendler = ki.ki_haendler || '';
    materialBelegdatum = ki.ki_belegdatum || '';
  } else {
    issues.push('Beleg/Materialkauf angegeben, aber Betrag nicht automatisch lesbar' + (ki && ki.ki_hinweis ? ' (KI: ' + ki.ki_hinweis + ')' : '') + '. Material manuell abrechnen (Beleg: ' + ((norm.belege_urls || []).concat(norm.foto_urls || [])[0] || 'kein Upload') + ')');
  }
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
const positions = [];
if (hoursCents > 0) positions.push({ type: 'POSITION', description: 'Hausmeister-/Handwerkerleistung am ' + datum + ' - ' + objekt + (leistung ? ' (' + leistung + ')' : ''), quantity: stunden, unit: 'Std.', single_price_net: CONFIG.RATE_HOUR_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (kmCents > 0) positions.push({ type: 'POSITION', description: 'Anfahrt am ' + datum + ' (Kilometerpauschale) - ' + objekt, quantity: km, unit: 'km', single_price_net: CONFIG.RATE_KM_CENTS, vat_percent: CONFIG.VAT_PERCENT });
if (materialAdjCents > 0) positions.push({ type: 'POSITION', description: 'Materialkosten lt. Beleg' + (materialHaendler ? ' (' + materialHaendler + (materialBelegdatum ? ', ' + materialBelegdatum : '') + ')' : '') + ' - ' + objekt, quantity: 1, unit: 'pauschal', single_price_net: materialAdjCents, vat_percent: CONFIG.VAT_PERCENT });

return { json: {
  row_id: claim.id,
  sheet_row: norm._sheet_row,
  form_submission_id: norm.form_submission_id,
  plausible: !skipInternal && issues.length === 0,
  skip_internal: skipInternal,
  hold_reason: skipInternal ? ('EIGENBESTAND ' + (ownerRow.owner_name || 'Bege Apartments GmbH') + ' - keine Weiterberechnung (CONFIG.SELF_OWNER_IDS)') : issues.join('; '),
  owner_id: streetRow.owner_id || null,
  owner_name: ownerRow.owner_name || '',
  easybill_customer_id: customerId || '',
  gdrive_folder_id: gdriveFolder,
  computed_amount_cents: totalCents,
  vat_percent: CONFIG.VAT_PERCENT,
  object_reference: objekt,
  datum: datum,
  einsatz_sort: iso || '',
  hausmeister: norm.hausmeister,
  stunden: isNaN(stunden) ? null : stunden,
  kilometer: isNaN(km) ? null : km,
  material_eur: norm.material_eur,
  material_quelle: materialQuelle,
  test_mode: CONFIG.TEST_MODE,
  alert_email: CONFIG.ALERT_EMAIL,
  positions: positions
} };
`;

const calc = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Berechnung + Plausibilitaet',
    position: [2280, 300],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: calcCode }
  },
  output: [{ row_id: '00000000-0000-0000-0000-000000000001', sheet_row: 8, plausible: true, skip_internal: false, hold_reason: '', owner_id: '67d436fdbb8161d020b37011', owner_name: 'André Michel', easybill_customer_id: '1234567', gdrive_folder_id: '1AbC', computed_amount_cents: 12446, vat_percent: 19, object_reference: 'Lösorter str 44', datum: '04.03.2026', einsatz_sort: '2026-03-04T00:00:00.000Z', material_quelle: 'beleg_ki', test_mode: false, alert_email: 'info@hostautomation.de', positions: [{ type: 'POSITION', description: 'x', quantity: 2.92, unit: 'Std.', single_price_net: 3000, vat_percent: 19 }] }]
});

const logCalc = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Berechnung',
    position: [2500, 300],
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
        { fieldId: 'raw_payload', fieldValue: expr("{{ JSON.stringify({ zeile: $('Normalisieren + Fingerprint').item.json.raw_row, positions: $json.positions, material_quelle: $json.material_quelle }) }}") },
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
    position: [2720, 300],
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

const collect = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fuer Sammelrechnung vormerken',
    position: [2940, 200],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "return { json: $('Berechnung + Plausibilitaet').item.json };" }
  },
  output: [{ plausible: true, easybill_customer_id: '1234567', positions: [] }]
});

const logHold = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: HOLD',
    position: [2940, 460],
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

const internIf = ifElse({
  version: 2.3,
  config: {
    name: 'Intern (ohne Mail-Alarm)?',
    position: [3160, 460],
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

const mailHold = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Eintrag angehalten',
    position: [3380, 540],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01 ANGEHALTEN: {{ $('Berechnung + Plausibilitaet').item.json.object_reference }} - keine Rechnung erstellt"),
      emailType: 'text',
      message: expr("Ein Formular-Eintrag wurde NICHT automatisch abgerechnet (Status: hold). Die Sheet-Zeile bleibt WEISS.\n\nSheet-Zeile: {{ $('Berechnung + Plausibilitaet').item.json.sheet_row }}\nObjekt: {{ $('Berechnung + Plausibilitaet').item.json.object_reference }}\nHausmeister: {{ $('Berechnung + Plausibilitaet').item.json.hausmeister }}\nDatum: {{ $('Berechnung + Plausibilitaet').item.json.datum }}\nStunden: {{ $('Berechnung + Plausibilitaet').item.json.stunden }} / km: {{ $('Berechnung + Plausibilitaet').item.json.kilometer }}\n\nGrund:\n{{ $('Berechnung + Plausibilitaet').item.json.hold_reason }}\n\nSupabase maintenance_invoices id: {{ $('Berechnung + Plausibilitaet').item.json.row_id }}\nNach Korrektur: Supabase-Zeile loeschen und den naechsten Abrechnungslauf starten - die weisse Zeile wird dann erneut verarbeitet."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail2' }]
});

const logErrorRow = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: FEHLER',
    position: [3160, 60],
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

const mailErrorRow = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Fehler-Alarm',
    position: [3380, 60],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01 FEHLER: {{ $('Normalisieren + Fingerprint').item.json.object_reference }} ({{ $('Normalisieren + Fingerprint').item.json.submitted_at_raw }})"),
      emailType: 'text',
      message: expr("Bei der Vorbereitung der Instandhaltungs-Abrechnung ist ein technischer Fehler aufgetreten.\n\nObjekt: {{ $('Normalisieren + Fingerprint').item.json.object_reference }}\nFormular-Fingerprint: {{ $('Normalisieren + Fingerprint').item.json.form_submission_id }}\n\nFehlerdetails:\n{{ JSON.stringify($json.error ?? $json).slice(0, 1500) }}\n\nDie Zeile steht in maintenance_invoices auf status=error. Nach Behebung: Supabase-Zeile loeschen und den naechsten Lauf starten."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail3' }]
});

const groupCode = `
// Plausible Zeilen nach Eigentuemer gruppieren -> EINE Sammelrechnung pro Eigentuemer.
// Gruppiert wird nach owner_id (stabil auch im Testbetrieb); die Rechnung geht an easybill_customer_id.
// ===== TESTBETRIEB =====
const TEST_CUSTOMER_ID = ''; // Testlauf: Easybill-Kunden-ID des Testkunden eintragen (z. B. 2648273633 = 'ZZZ TEST', Nr. 10077) => alle Entwuerfe gehen dorthin, Titel [TESTLAUF <Owner>]. FUER LIVEBETRIEB LEER LASSEN!
// =======================
const items = $input.all().map(i => i.json).filter(j => j && j.plausible === true && Array.isArray(j.positions) && j.positions.length);
if (!items.length) return [];
const groups = {};
for (const it of items){
  const k = String(it.owner_id || it.easybill_customer_id);
  if (!groups[k]) groups[k] = [];
  groups[k].push(it);
}
const out = [];
const heute = $now.toFormat('dd.MM.yyyy');
for (const k of Object.keys(groups)){
  const rows = groups[k].sort((a, b) => String(a.einsatz_sort).localeCompare(String(b.einsatz_sort)));
  const positions = [];
  for (const r of rows) positions.push(...r.positions);
  const total = rows.reduce((a, r) => a + (r.computed_amount_cents || 0), 0);
  const daten = rows.map(r => r.datum).filter(Boolean);
  const zeitraum = daten.length ? (daten[0] + ' - ' + daten[daten.length - 1]) : heute;
  const testMode = !!TEST_CUSTOMER_ID;
  const customerId = testMode ? Number(TEST_CUSTOMER_ID) : (Number(rows[0].easybill_customer_id) || 0);
  const prefix = testMode ? ('[TESTLAUF ' + (rows[0].owner_name || k) + '] ') : '';
  out.push({ json: {
    easybill_customer_id: String(customerId),
    owner_id: rows[0].owner_id,
    owner_name: rows[0].owner_name,
    gdrive_folder_id: testMode ? '' : (rows[0].gdrive_folder_id || ''),
    row_ids: rows.map(r => r.row_id),
    sheet_rows: rows.map(r => r.sheet_row).filter(n => Number.isInteger(n)),
    einsaetze: rows.length,
    summe_cents: total,
    test_mode: testMode,
    easybill_payload: {
      type: 'INVOICE',
      customer_id: customerId,
      currency: 'EUR',
      title: prefix + 'Rechnung Instandhaltung',
      text_prefix: prefix + 'Instandhaltungsleistungen Bege Apartments, Zeitraum ' + zeitraum + '. Einzelne Einsaetze siehe Positionen.',
      text: 'Vielen Dank fuer Ihr Vertrauen.',
      items: positions
    },
    easybill_send_payload: {
      subject: prefix + 'Ihre Rechnung - Instandhaltung ' + zeitraum + ' (Bege Apartments)',
      message: 'Sehr geehrte Damen und Herren,' + String.fromCharCode(10) + String.fromCharCode(10) +
        'anbei erhalten Sie die Sammelrechnung fuer Instandhaltungsarbeiten im Zeitraum ' + zeitraum + '.' +
        String.fromCharCode(10) + String.fromCharCode(10) + 'Mit freundlichen Gruessen' + String.fromCharCode(10) + 'Bege Apartments GmbH'
    }
  }});
}
return out;
`;

const groupOwners = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Nach Eigentuemer gruppieren',
    position: [80, 900],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: groupCode }
  },
  output: [{ easybill_customer_id: '1234567', owner_name: 'André Michel', row_ids: ['00000000-0000-0000-0000-000000000001'], sheet_rows: [8], einsaetze: 2, summe_cents: 24892, gdrive_folder_id: '1AbC', test_mode: false, easybill_payload: { type: 'INVOICE', customer_id: 1234567, currency: 'EUR', items: [] }, easybill_send_payload: { subject: 's', message: 'm' } }]
});

const sibOwner = splitInBatches({
  version: 3,
  config: { name: 'Je Eigentuemer', position: [300, 900], parameters: { batchSize: 1, options: {} } }
});

const ebCreate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Sammel-Entwurf anlegen',
    position: [540, 900],
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
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ $('Je Eigentuemer').item.json.easybill_payload }}")
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{ id: 987654, number: null, is_draft: true, amount: 24892 }]
});

const logInvoiceRows = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Entwurf an allen Zeilen',
    position: [760, 900],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'string',
      filterString: expr("id=in.({{ $('Je Eigentuemer').item.json.row_ids.join(',') }})"),
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'easybill_document_id', fieldValue: expr("{{ $('Easybill: Sammel-Entwurf anlegen').item.json.id }}") },
        { fieldId: 'status', fieldValue: 'invoice_created' },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'processed_at', fieldValue: expr('{{ $now.toISO() }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'invoice_created' }]
});

const colorRows = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Sheet: Zeilen GRUEN faerben',
    position: [980, 900],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://sheets.googleapis.com/v4/spreadsheets/16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU:batchUpdate',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ { requests: $('Je Eigentuemer').item.json.sheet_rows.map(r => ({ repeatCell: { range: { sheetId: 1207695698, startRowIndex: r - 1, endRowIndex: r }, cell: { userEnteredFormat: { backgroundColor: { red: 0.0, green: 0.9, blue: 0.1 } } }, fields: 'userEnteredFormat.backgroundColor' } })) } }}")
    }
  },
  output: [{ spreadsheetId: '16rx' }]
});

const ebDone = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Festschreiben',
    position: [1200, 900],
    disabled: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'PUT',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Sammel-Entwurf anlegen').item.json.id }}/done"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth'
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{ id: 987654, number: 'RE-2026-1042' }]
});

const ebSend = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: E-Mail-Versand',
    position: [1420, 900],
    disabled: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Sammel-Entwurf anlegen').item.json.id }}/send/email"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ $('Je Eigentuemer').item.json.easybill_send_payload }}")
    },
    credentials: { httpBearerAuth: { id: '5r9s6E4Kyry4jDMt', name: 'easybill api jonas bege' } }
  },
  output: [{}]
});

const pacing = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Pacing (Rate-Limit)',
    position: [1640, 900],
    parameters: { resume: 'timeInterval', amount: 15, unit: 'seconds' }
  },
  output: [{}]
});

const logErrorOwner = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: FEHLER (Eigentuemer)',
    position: [980, 1160],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'maintenance_invoices',
      filterType: 'string',
      filterString: expr("id=in.({{ $('Je Eigentuemer').item.json.row_ids.join(',') }})"),
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

const mailErrorOwner = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Fehler-Alarm (Eigentuemer)',
    position: [1200, 1160],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-01 FEHLER Sammelrechnung: {{ $('Je Eigentuemer').item.json.owner_name }}"),
      emailType: 'text',
      message: expr("Beim Erstellen der Sammelrechnung fuer {{ $('Je Eigentuemer').item.json.owner_name }} ({{ $('Je Eigentuemer').item.json.einsaetze }} Einsaetze, {{ ($('Je Eigentuemer').item.json.summe_cents / 100).toFixed(2) }} EUR netto) ist ein Fehler aufgetreten.\n\nFehlerdetails:\n{{ JSON.stringify($json.error ?? $json).slice(0, 1500) }}\n\nBetroffene maintenance_invoices ids: {{ $('Je Eigentuemer').item.json.row_ids.join(', ') }}\nDie Sheet-Zeilen bleiben WEISS. Nach Behebung: Supabase-Zeilen loeschen und Lauf erneut starten."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail4' }]
});

const summaryCode = `
let gruppen = [];
try { gruppen = $('Nach Eigentuemer gruppieren').all().map(i => i.json).filter(j => j && j.easybill_customer_id); } catch (e) { gruppen = []; }
const anz = gruppen.length;
const summe = gruppen.reduce((a, g) => a + (g.summe_cents || 0), 0);
const zeilen = gruppen.reduce((a, g) => a + (g.einsaetze || 0), 0);
const liste = gruppen.map(g => '- ' + (g.owner_name || g.easybill_customer_id) + ': ' + g.einsaetze + ' Einsaetze, ' + ((g.summe_cents || 0) / 100).toFixed(2) + ' EUR netto').join(String.fromCharCode(10));
return [{ json: { anzahl_rechnungen: anz, anzahl_einsaetze: zeilen, summe_eur: (summe / 100).toFixed(2), liste: liste || '(keine)' } }];
`;

const summary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Lauf-Zusammenfassung bauen',
    position: [540, 700],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: summaryCode }
  },
  output: [{ anzahl_rechnungen: 3, anzahl_einsaetze: 9, summe_eur: '512.30', liste: '- ...' }]
});

const mailSummary = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Lauf-Zusammenfassung',
    position: [760, 700],
    executeOnce: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr('Bege Abrechnungslauf: {{ $json.anzahl_rechnungen }} Entwurf/Entwuerfe erstellt ({{ $json.summe_eur }} EUR netto)'),
      emailType: 'text',
      message: expr("Der Instandhaltungs-Abrechnungslauf ist durch.\n\nErstellte Easybill-ENTWUERFE (Freigabemodus - bitte in Easybill pruefen, festschreiben und versenden):\n{{ $json.liste }}\n\nEinsaetze gesamt: {{ $json.anzahl_einsaetze }}\nSumme netto: {{ $json.summe_eur }} EUR\n\nAbgerechnete Sheet-Zeilen wurden GRUEN gefaerbt. Weisse Zeilen = offen oder angehalten (siehe ggf. separate HOLD-Mails)."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail5' }]
});

const docsSticky = sticky(
  '## HW-01 v3 - SAMMELABRECHNUNG im Zyklus (Bege Apartments)\n\nLauf (manuell oder Zeitplan): liest das Antwort-Sheet inkl. FARBEN. Nur WEISSE Zeilen werden verarbeitet (gruen = bereits abgerechnet). Pro Eigentuemer entsteht EINE Sammelrechnung mit Positionen je Einsatz (Stunden 30,00/h + km 0,45 + Material via Beleg-KI). Danach werden die Zeilen GRUEN gefaerbt.\n\nFREIGABEMODUS: "Festschreiben" + "E-Mail-Versand" sind deaktiviert => es entstehen nur ENTWUERFE, Jonas prueft/versendet in Easybill. Nach 5 sauberen Laeufen beide Nodes aktivieren.\n\nZyklus: Schedule-Trigger (14-taegig Mo 06:00) greift erst, wenn der Workflow AKTIVIERT wird - Zeitzyklus wird spaeter final festgelegt. Bis dahin: manuell starten.\n\nSchutz: Farb-Filter + unique form_submission_id (Duplikate stoppen still). Reprocess: Supabase-Zeile loeschen + Lauf neu starten (weisse Zeile wird wieder aufgegriffen).\n\n⚠️ Credentials noch zu teilen/waehlen (siehe README-Checkliste): (1) Anthropic-Credential fuer Beleg-KI, (2) Google-Sheets-VOLL-Credential (Schreiben: gruen faerben + KI-Spalten) - bis dahin: Faerben/KI-Writeback schlagen leise fehl (Mail-Hinweis), Belege gehen auf HOLD.',
  [],
  { color: 3, width: 700, height: 460 }
);

export default workflow('bege-hw01-v3-sammelabrechnung', 'Bege | HW-01 v3 Instandhaltung → Easybill (Sammelabrechnung)')
  .add(startManual)
  .to(readSheet)
  .add(startSchedule)
  .to(readSheet)
  .add(readSheet)
  .to(normalize)
  .to(sib
    .onDone(groupOwners)
    .onEachBatch(
      claimInsert
        .to(belegIf
          .onTrue(belegParse
            .to(belegLoad
              .to(belegKi
                .to(belegResult
                  .to(kiRow
                    .to(kiWrite
                      .to(lookupStreet)
                    )
                  )
                )
              )
            )
          )
          .onFalse(lookupStreet)
        )
    )
  )
  .add(lookupStreet)
  .to(lookupOwner
    .to(calc
      .to(logCalc
        .to(plausibleIf
          .onTrue(collect.to(nextBatch(sib)))
          .onFalse(logHold
            .to(internIf
              .onTrue(nextBatch(sib))
              .onFalse(mailHold.to(nextBatch(sib)))
            )
          )
        )
      )
    )
  )
  .add(claimInsert.onError(dupCheck.onTrue(skipDuplicate.to(nextBatch(sib))).onFalse(logErrorRow)))
  .add(lookupStreet.onError(logErrorRow))
  .add(lookupOwner.onError(logErrorRow))
  .add(logCalc.onError(logErrorRow))
  .add(logErrorRow.to(mailErrorRow.to(nextBatch(sib))))
  .add(groupOwners)
  .to(sibOwner
    .onDone(summary.to(mailSummary))
    .onEachBatch(
      ebCreate
        .to(logInvoiceRows
          .to(colorRows
            .to(ebDone
              .to(ebSend
                .to(pacing.to(nextBatch(sibOwner)))
              )
            )
          )
        )
    )
  )
  .add(ebCreate.onError(logErrorOwner))
  .add(logInvoiceRows.onError(logErrorOwner))
  .add(colorRows.onError(logErrorOwner))
  .add(ebDone.onError(logErrorOwner))
  .add(ebSend.onError(logErrorOwner))
  .add(logErrorOwner.to(mailErrorOwner.to(pacing)))
  .add(docsSticky);
