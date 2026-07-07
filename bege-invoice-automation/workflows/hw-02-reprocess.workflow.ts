import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, merge, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start (manuell)', position: [-600, 300] },
  output: [{}]
});

const loadAuto = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lade Fehler-Zeilen (auto)',
    position: [-360, 200],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'maintenance_invoices',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'status', condition: 'eq', keyValue: 'error' },
        { keyName: 'is_processing', condition: 'eq', keyValue: 'false' },
        { keyName: 'easybill_document_id', condition: 'is', keyValue: 'null' }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', form_submission_id: 'x', status: 'error', raw_payload: '{}', retry_count: 0, owner_id: 'abc', object_reference: 'Musterstr. 1' }]
});

const loadSending = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lade sending-Zeilen',
    position: [-360, 560],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'maintenance_invoices',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'status', condition: 'eq', keyValue: 'sending' }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000002', status: 'sending', object_reference: 'Musterstr. 2', invoice_number: 'RE-1', easybill_document_id: '1', error_message: null }]
});

const loadErrorWithDoc = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lade Fehler mit Easybill-Dokument',
    position: [-360, 760],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'maintenance_invoices',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'status', condition: 'eq', keyValue: 'error' },
        { keyName: 'easybill_document_id', condition: 'neq', keyValue: 'null' }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000003', status: 'error', object_reference: 'Musterstr. 3', invoice_number: null, easybill_document_id: '99', error_message: 'x' }]
});

const mergeReview = merge({
  version: 3.2,
  config: { name: 'Pruef-Zeilen zusammenfuehren', position: [-120, 660], parameters: { mode: 'append' } }
});

const buildReportCode = `
const items = $input.all();
if (!items.length) return [];
const lines = items.map(it => {
  const r = it.json;
  return '- id=' + r.id + ' | status=' + r.status + ' | Objekt=' + (r.object_reference || '?') +
    ' | easybill_document_id=' + (r.easybill_document_id || '-') + ' | Rechnung=' + (r.invoice_number || '-') +
    ' | Fehler=' + String(r.error_message || '').slice(0, 160);
});
return [{ json: { count: items.length, report: lines.join(String.fromCharCode(10)) } }];
`;

const buildReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pruef-Bericht bauen',
    position: [100, 660],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildReportCode }
  },
  output: [{ count: 2, report: '- id=... | status=sending ...' }]
});

const mailReview = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Manuell pruefen',
    position: [320, 660],
    executeOnce: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr('Bege HW-02: {{ $json.count }} Zeile(n) manuell pruefen'),
      emailType: 'text',
      message: expr("Folgende maintenance_invoices-Zeilen brauchen manuelle Pruefung (kein automatischer Neuanlauf):\n\n{{ $json.report }}\n\nAnleitung:\n- status=sending: In Easybill pruefen, ob die Rechnung versendet wurde. Falls ja: Zeile in Supabase auf status=sent/completed setzen. Falls nein: Versand in Easybill ausloesen.\n- status=error MIT easybill_document_id: Zustand des Dokuments in Easybill pruefen (Entwurf? festgeschrieben? versendet?) und Zeile entsprechend korrigieren.\n- status=hold: Ursache beheben (Sheet/Mapping) und den Eintrag ueber das Google-Formular NEU einreichen - neuer Fingerprint, HW-01 verarbeitet ihn frisch; die hold-Zeile bleibt als Audit-Trail."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail-review' }]
});

const sibR = splitInBatches({
  version: 3,
  config: { name: 'Einzeln (Reprocess)', position: [-120, 200], parameters: { batchSize: 1, options: {} } }
});

const readPayloadCode = `
const row = $json;
let rp = row.raw_payload;
if (typeof rp === 'string') { try { rp = JSON.parse(rp); } catch (e) { rp = {}; } }
rp = rp || {};
const payload = rp.easybill_payload;
const sendPayload = rp.easybill_send_payload;
const ok = !!(payload && payload.customer_id && Number(payload.customer_id) > 0 && Array.isArray(payload.items) && payload.items.length > 0);
return { json: {
  row_id: row.id,
  form_submission_id: row.form_submission_id,
  owner_id: row.owner_id || null,
  object_reference: row.object_reference || '',
  retry_count_neu: (row.retry_count || 0) + 1,
  ok: ok,
  skip_reason: ok ? '' : 'Reprocess uebersprungen: kein gueltiges easybill_payload in raw_payload. Zeile nach Korrektur per Google-Formular NEU einreichen (HW-01 verarbeitet sie frisch).',
  easybill_payload: payload || {},
  easybill_send_payload: sendPayload || { subject: 'Ihre Rechnung (Bege Apartments)', message: 'Sehr geehrte Damen und Herren, anbei erhalten Sie Ihre Rechnung. Mit freundlichen Gruessen, Bege Apartments GmbH' }
} };
`;

const readPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Payload lesen',
    position: [120, 200],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: readPayloadCode }
  },
  output: [{ row_id: '00000000-0000-0000-0000-000000000001', ok: true, retry_count_neu: 1, owner_id: 'abc', object_reference: 'Musterstr. 1', easybill_payload: { customer_id: 123, items: [{}] }, easybill_send_payload: { subject: 's', message: 'm' } }]
});

const payloadOk = ifElse({
  version: 2.3,
  config: {
    name: 'Payload vorhanden?',
    position: [340, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr('{{ $json.ok }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }
        ]
      }
    }
  }
});

const markProcessing = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Markiere processing',
    position: [560, 120],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'status', fieldValue: 'processing' },
        { fieldId: 'is_processing', fieldValue: expr('{{ true }}') },
        { fieldId: 'retry_count', fieldValue: expr("{{ $('Payload lesen').item.json.retry_count_neu }}") },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'processing' }]
});

const lookupDrive = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Lookup: Drive-Ordner',
    position: [780, 120],
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
        { keyName: 'owner_id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.owner_id ?? '__kein_match__' }}") }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ owner_id: 'abc', owner_name: 'X', gdrive_folder_id: '1AbC' }]
});

const ebCreateR = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Entwurf anlegen',
    position: [1000, 120],
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
      jsonBody: expr("{{ $('Payload lesen').item.json.easybill_payload }}")
    }
  },
  output: [{ id: 987654, number: null, is_draft: true }]
});

const logCreatedR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Entwurf erstellt',
    position: [1220, 120],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'easybill_document_id', fieldValue: expr('{{ $json.id }}') },
        { fieldId: 'status', fieldValue: 'invoice_created' },
        { fieldId: 'error_message', fieldValue: '' },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'invoice_created' }]
});

const ebDoneR = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: Festschreiben',
    position: [1440, 120],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      method: 'PUT',
      url: expr("https://api.easybill.de/rest/v1/documents/{{ $('Easybill: Entwurf anlegen').item.json.id }}/done"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth'
    }
  },
  output: [{ id: 987654, number: 'RE-2026-1042' }]
});

const logNumberR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Rechnungsnummer',
    position: [1660, 120],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'invoice_number', fieldValue: expr('{{ $json.number }}') },
        { fieldId: 'status', fieldValue: 'sending' },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'sending' }]
});

const ebSendR = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: E-Mail-Versand',
    position: [1880, 120],
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
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ $('Payload lesen').item.json.easybill_send_payload }}")
    }
  },
  output: [{}]
});

const logSentR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Versendet',
    position: [2100, 120],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
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

const ebPdfR = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Easybill: PDF laden',
    position: [2320, 120],
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
    }
  },
  output: [{}]
});

const driveIfR = ifElse({
  version: 2.3,
  config: {
    name: 'Drive-Ordner vorhanden?',
    position: [2540, 120],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { leftValue: expr("{{ $('Lookup: Drive-Ordner').item.json.gdrive_folder_id }}"), operator: { type: 'string', operation: 'notEmpty', singleValue: true } }
        ]
      }
    }
  }
});

const driveUploadR = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Drive: PDF ablegen',
    position: [2760, 40],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'file',
      operation: 'upload',
      inputDataFieldName: 'data',
      name: expr("RE-{{ $('Easybill: Festschreiben').item.json.number }} - Instandhaltung {{ $('Payload lesen').item.json.object_reference }}.pdf"),
      driveId: { __rl: true, mode: 'list', value: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: expr("{{ $('Lookup: Drive-Ordner').item.json.gdrive_folder_id }}") }
    }
  },
  output: [{ id: '1DriveFileId' }]
});

const logCompletedR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Abgeschlossen',
    position: [2980, 40],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
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

const logNoDriveR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Abgeschlossen ohne Drive',
    position: [2760, 240],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
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

const logSkip = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: Uebersprungen',
    position: [560, 360],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'error_message', fieldValue: expr("{{ $('Payload lesen').item.json.skip_reason }}") },
        { fieldId: 'is_processing', fieldValue: expr('{{ false }}') },
        { fieldId: 'updated_at', fieldValue: expr('{{ $now.toISO() }}') }
      ] }
    },
    credentials: { supabaseApi: { id: 'VoEVcY26VNebXyjK', name: 'Jonas Rechnungsworkflow' } }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000001', status: 'error' }]
});

const logErrorR = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log: FEHLER',
    position: [1440, 460],
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
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Payload lesen').item.json.row_id }}") }] },
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

const mailErrorR = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Mail: Fehler-Alarm',
    position: [1660, 460],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'info@hostautomation.de',
      subject: expr("Bege HW-02 FEHLER beim Reprocess: {{ $('Payload lesen').item.json.object_reference }}"),
      emailType: 'text',
      message: expr("Beim erneuten Verarbeiten (Reprocess) ist wieder ein Fehler aufgetreten.\n\nSupabase maintenance_invoices id: {{ $('Payload lesen').item.json.row_id }}\nObjekt: {{ $('Payload lesen').item.json.object_reference }}\n\nFehlerdetails:\n{{ JSON.stringify($json.error ?? $json).slice(0, 1500) }}"),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'viBiXuVDXJc9eiVs', name: 'Hostautomation' } }
  },
  output: [{ id: 'mail-err' }]
});

const pacingR = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Pacing (Rate-Limit)',
    position: [3200, 360],
    parameters: { resume: 'timeInterval', amount: 30, unit: 'seconds' }
  },
  output: [{}]
});

const doneR = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Reprocess abgeschlossen', position: [-120, 40], parameters: {} },
  output: [{}]
});

const stickyR = sticky(
  '## HW-02 Reprocess (Instandhaltung)\n\nManuell starten. Verarbeitet maintenance_invoices-Zeilen mit **status=error ohne easybill_document_id** automatisch neu (gespeichertes easybill_payload aus raw_payload). Zeilen mit status=sending oder error MIT Dokument werden nur per Mail zur manuellen Pruefung gemeldet (Versand ist nicht idempotent!).\n\nHOLD-Zeilen: Ursache beheben und Eintrag per Google-Formular NEU einreichen (neuer Fingerprint, HW-01 verarbeitet frisch).\n\n**Vor Nutzung:** Credential "easybill api jonas bege" mit diesem Projekt teilen und in den 3 Easybill-Nodes auswaehlen; Drive-Credential im Node "Drive: PDF ablegen" pruefen. Siehe bege-invoice-automation/README.de.md.',
  [],
  { color: 2, width: 560, height: 340 }
);

export default workflow('bege-hw02-reprocess', 'Bege | HW-02 Reprocess (Instandhaltung)')
  .add(start)
  .to(loadAuto)
  .to(sibR
    .onDone(doneR)
    .onEachBatch(
      readPayload
        .to(payloadOk
          .onTrue(markProcessing
            .to(lookupDrive
              .to(ebCreateR
                .to(logCreatedR
                  .to(ebDoneR
                    .to(logNumberR
                      .to(ebSendR
                        .to(logSentR
                          .to(ebPdfR
                            .to(driveIfR
                              .onTrue(driveUploadR.to(logCompletedR.to(pacingR)))
                              .onFalse(logNoDriveR.to(pacingR))
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
          .onFalse(logSkip.to(pacingR))
        )
    )
  )
  .add(start)
  .to(loadSending)
  .to(mergeReview.input(0))
  .add(start)
  .to(loadErrorWithDoc)
  .to(mergeReview.input(1))
  .add(mergeReview)
  .to(buildReport)
  .to(mailReview)
  .add(markProcessing.onError(logErrorR))
  .add(lookupDrive.onError(logErrorR))
  .add(ebCreateR.onError(logErrorR))
  .add(logCreatedR.onError(logErrorR))
  .add(ebDoneR.onError(logErrorR))
  .add(logNumberR.onError(logErrorR))
  .add(ebSendR.onError(logErrorR))
  .add(logSentR.onError(logErrorR))
  .add(ebPdfR.onError(logErrorR))
  .add(driveUploadR.onError(logErrorR))
  .add(logNoDriveR.onError(logErrorR))
  .add(logErrorR.to(mailErrorR.to(pacingR)))
  .add(pacingR.to(nextBatch(sibR)))
  .add(stickyR);
