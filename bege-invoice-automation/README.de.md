# Automatisierte Instandhaltungs-Abrechnung – Bege Apartments

Umsetzung des Konzeptdokuments v0.1 (07.07.2026): Hausmeister füllt das Google-Formular aus → n8n erstellt und versendet automatisch die Easybill-Rechnung an den Eigentümer, legt das PDF im Eigentümer-Drive-Ordner ab und protokolliert alles in Supabase. **Übergabe erfolgt inaktiv** — Aktivierung erst nach der Go-live-Checkliste unten.

## Was wurde gebaut

| Komponente | Wo | Status |
|---|---|---|
| Workflow **„Bege \| HW-01 Instandhaltung → Easybill"** | n8n, Projekt „Jonas Bege X hostauomation", ID `x3VnwfVHMnCOfuvi` | ✅ gebaut, logikgetestet, **inaktiv** |
| Workflow **„Bege \| HW-02 Reprocess (Instandhaltung)"** | n8n, gleiches Projekt, ID `FTxrBxjV24y2GVDd` | ✅ gebaut, Smoke-Test grün, manuell zu starten |
| Tabelle **`maintenance_invoices`** (Protokoll/Idempotenz) | Supabase „Jonas rechnungsworkflow" (`hzeephtezapvgouguigz`) | ✅ angelegt (RLS aktiv, anon gesperrt) |
| View **`owner_mapping_billing`** (nur Abrechnungs-Spalten, keine OrgaMax-Keys) | Supabase | ✅ angelegt |
| Tabelle **`object_owner_map`** (Objekt → Eigentümer) | Supabase | ✅ angelegt + Seed aus `booking_invoices`: 399 Schlüssel, 45/47 Eigentümer |
| **RLS-Fix `tenants`** (Sicherheitslücke aus Konzept §6.7) | Supabase | ✅ aktiviert, Advisor-Finding behoben, Alt-Workflows unbeeinträchtigt (service_role) |
| Quellcode, Migrationen, Doku, Lücken-Report | dieses Verzeichnis | ✅ |

## Ablauf HW-01 (pro neuer Formular-Zeile)

1. **Google-Sheets-Trigger** (Polling 1 min, nur NEUE Zeilen — der erste Poll nach Aktivierung emittiert nachweislich keine Altzeilen).
2. **Normalisieren + Fingerprint**: Spalten-Mapping, deutsche Zahlen, Zeitstempel; Zeilen vor `GO_LIVE_TS` werden verworfen; Fingerprint für Idempotenz. Zentraler CONFIG-Block (→ `config/abrechnung-konfiguration.md`).
3. **Claim-Insert** in `maintenance_invoices` — Duplikate (unique `form_submission_id`) stoppen still über den 409-Pfad.
4. **Owner-Lookup**: `object_owner_map` (Objekt → owner_id) → `owner_mapping_billing` (easybill_customer_id, Drive-Ordner). Der Workflow liest **nie** direkt `owner_mapping` (OrgaMax-Keys bleiben unsichtbar).
5. **Berechnung + Plausibilität**: Stunden×Satz + km×Pauschale + Material(±Aufschlag), alles in Cent; ~10 Prüfungen (Grenzen, Beleg-Pflicht, Owner gefunden, …).
6. **Unplausibel ⇒ HOLD**: Status `hold` + E-Mail an info@hostautomation.de — **es wird keine Rechnung erstellt** (Erfolgskriterium aus Konzept §3).
7. **Plausibel ⇒ Easybill**: `POST /documents` (Entwurf) → `PUT /documents/{id}/done` (Rechnungsnummer) → `POST /documents/{id}/send/email` (Versand an die beim Easybill-Kunden hinterlegte Adresse) → `GET /documents/{id}/pdf`. Nach jedem Schritt Status-Update (`invoice_created` → `sending` → `sent`) — der nicht-idempotente Versand ist so isoliert.
8. **Drive-Ablage** in den Eigentümer-Ordner (`gdrive_folder_id`); fehlt der Ordner: Status `completed_no_drive` + Hinweis-Mail, Rechnung selbst ist komplett.
9. **Fehlerpfad**: Jeder externe Call hat Retry (3×, 5 s) und leitet Fehler auf Status `error` + Alarm-Mail; Rate-Limit-Pacing 30 s pro Rechnung.

## HW-02 Reprocess (manuell starten)

- Verarbeitet `status=error`-Zeilen **ohne** `easybill_document_id` automatisch neu (gespeichertes Payload aus `raw_payload` — Sätze bleiben die zum Zeitpunkt der Original-Berechnung, korrekt so).
- `status=sending` oder `error` **mit** Easybill-Dokument ⇒ nur Mail-Report zur manuellen Prüfung (Versand ist nicht idempotent — nie blind wiederholen).
- **HOLD-Zeilen** werden nicht automatisch neu berechnet: Ursache beheben (Sheet/Mapping) und den Einsatz **per Formular neu einreichen** — neuer Fingerprint, HW-01 verarbeitet frisch, die hold-Zeile bleibt als Audit-Trail.

## 🚀 Go-live-Checkliste (in dieser Reihenfolge)

1. **Sheet verdrahten** (sobald Leons Formular-Link da ist): Im Trigger-Node Dokument-ID + Blatt setzen (aktuell Platzhalter `ERSETZEN_…`) und ein **Google-Sheets-Trigger-Credential wählen** (keines ist derzeit mit dem Projekt „Jonas Bege X hostauomation" geteilt — ggf. in den Credential-Einstellungen teilen).
2. **`COLUMN_MAP` gegen die echten Spaltenüberschriften prüfen** (→ `config/abrechnung-konfiguration.md`); Testzeile einreichen und im Execution-Log kontrollieren.
3. **Sätze verifizieren** ⚠️: 3–5 historische Sheet-Einträge mit den zugehörigen Easybill-Rechnungen abgleichen; `RATE_HOUR_CENTS`, `RATE_KM_CENTS`, `MATERIAL_MARKUP_PCT`, `VAT_PERCENT` im CONFIG-Block festschreiben. **Die aktuellen Werte (45 €/h, 0,50 €/km, 1:1, 19 %) sind unbestätigte Platzhalter.**
4. **Easybill-Credential**: `easybill api jonas bege` in den Credential-Einstellungen **mit dem Projekt „Jonas Bege X hostauomation" teilen** und danach in den 4 Easybill-Nodes von HW-01 (+ 3 in HW-02) auswählen. (Per API nicht möglich — einmalig in der UI; der Ausführungs-Check blockiert sonst jede Ausführung.)
5. **Drive-Credential prüfen**: Im Node „Drive: PDF ablegen" ist aktuell „Ela immbilien GmbH" gewählt (einziges projektgeteiltes Drive-Credential). Prüfen, ob dieses Konto Schreibzugriff auf die Eigentümer-Ordner („Jonas Managment Rechnungen") hat — sonst korrektes Credential teilen/wählen.
6. **Testkunde + Testlauf**: In Easybill Kunden „ZZZ TEST – NICHT VERWENDEN" (E-Mail = Jonas) anlegen; `TEST_CUSTOMER_ID` setzen; Workflow aktivieren; eine Testzeile ins Formular ⇒ Rechnung mit `[TESTLAUF]` muss bei Jonas ankommen, Supabase-Zeile durchläuft `processing → … → completed`. Dabei einmal prüfen, ob der Easybill-Versand ohne `to`-Feld die Kundenadresse nutzt (erwartet, aber nicht offiziell dokumentiert — sonst im Send-Body `"to"` ergänzen).
7. **Scharfschalten**: `GO_LIVE_TS` auf den Go-live-Tag setzen, `TEST_MODE: false`, speichern. Erste echte Rechnung mit einem „freundlichen" Eigentümer begleiten.
8. Optional: In den Workflow-Einstellungen von HW-01 den Error-Workflow „Error Handler – Rechnungs-Workflows (E-Mail Alert)" (`FSevOW6IDQwnCMvs`) hinterlegen — fängt auch Trigger-/Infrastrukturfehler außerhalb der verdrahteten Fehlerpfade.
9. `reports/gdrive-luecken-2026-07-07.md` abarbeiten (17 fehlende Drive-Ordner, 2 fehlende Easybill-IDs, 2 Eigentümer ohne Objekt-Mapping).

## ⚠️ Betriebsregeln

- **Niemals „Execute workflow" auf dem aktiven HW-01 klicken** — der manuelle Modus emittiert ALLE Sheet-Zeilen (Massen-Fakturierungs-Risiko). Tests nur mit Pin-Daten oder gegen ein Test-Sheet. (Selbst dann greifen noch `GO_LIVE_TS`-Cutoff und der Duplikat-Claim als Schutzschichten.)
- Im Sheet keine Zeilen löschen oder mittendrin einfügen; Spalten nicht umbenennen (sonst lauter Stopp). Formular-Änderungen vorher ankündigen → `COLUMN_MAP` anpassen.
- Status-Bedeutungen: `hold` = fachlich angehalten (Mail kam), `error` = technisch (HW-02 starten), `completed_no_drive` = Rechnung ok, nur Ablage fehlt, `sending` = manuell in Easybill prüfen.

## 🔒 Sicherheitsbefunde (über das Konzeptdokument hinaus)

Das Konzept nannte nur die fehlende RLS auf `tenants` (✅ behoben). Bei der Prüfung kam zusätzlich heraus — **nicht eigenmächtig geändert**, da ein unbekannter anon-Konsument nicht ausgeschlossen werden konnte:

1. **`owner_mapping` und `booking_invoices` sind trotz aktiviertem RLS praktisch offen**: Die Policy „Service role full access" gilt mit `USING (true)` für **alle** Rollen, und `anon`/`authenticated` haben volle Tabellen-Grants. Damit sind die **OrgaMax-API-Keys** (owner_mapping) und Gäste-Daten (booking_invoices) mit dem anon-Key les- UND schreibbar. Empfohlener Fix, sobald bestätigt ist, dass keine externe App den anon-Key nutzt: Policy auf `to service_role` einschränken oder ersatzlos streichen (service_role bypasst RLS ohnehin) und `revoke all … from anon, authenticated;`.
2. Funktion **`upsert_booking_invoice`** ist SECURITY DEFINER und für `anon` per `/rest/v1/rpc/…` aufrufbar.
3. Views `v_pending_ota_invoices` / `v_invoices_to_cancel` sind SECURITY DEFINER (Advisor-ERROR).
4. Alle neuen Objekte dieses Projekts (maintenance_invoices, object_owner_map, owner_mapping_billing) sind korrekt gesperrt (RLS ohne anon-Policies + revoke).

## Dateien

```
bege-invoice-automation/
├── README.de.md                        ← dieses Runbook
├── config/abrechnung-konfiguration.md  ← alle CONFIG-Schalter (Sätze = PLATZHALTER!)
├── reports/gdrive-luecken-2026-07-07.md
├── supabase/migrations/                ← angewendete Migrationen (Referenz)
└── workflows/                          ← SDK-Quellcode beider Workflows
                                          (Hinweis: enthält die Ziel-Credentials; auf der Instanz
                                          müssen Easybill/Sheets/Drive-Credentials nach dem
                                          Teilen manuell gewählt werden, s. Checkliste 1/4/5)
```

## Offene Punkte aus dem Konzept — Stand

| Frage (Konzept §9) | Antwort |
|---|---|
| Easybill-API: Erstellung UND Versand automatisierbar? | **Ja** — create → done → send/email → pdf, alles verbaut. Preise in Cent. Rate-Limit tarifabhängig (PLUS 10/min) → 30s-Pacing. |
| Exakte Formularfelder | Offen bis Leons Link da ist; `COLUMN_MAP` ist darauf vorbereitet (Checkliste 1–2). |
| Stundensatz/km-Pauschale | Platzhalter, Verifikation = Checkliste 3. |
| Material 1:1 oder Aufschlag? | Konfigurierbar (`MATERIAL_MARKUP_PCT`), Default 1:1, Verifikation = Checkliste 3. |
| Umgang mit unvollständigen Eingaben | HOLD + Mail statt Rechnung; Beleg-Pflicht bei Material konfigurierbar (`REQUIRE_RECEIPT_FOR_MATERIAL`, Default an). |
