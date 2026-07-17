# Automatisierte Instandhaltungs-Abrechnung – Bege Apartments

Umsetzung des Konzeptdokuments v0.1 (07.07.2026), am **17.07.2026 an das echte Formular angepasst und live-vorbereitet**: Hausmeister füllt das Google-Formular „Checkliste Instandhaltung" aus → n8n erstellt und versendet automatisch die Easybill-Rechnung an den Eigentümer, legt das PDF im Eigentümer-Drive-Ordner ab und protokolliert alles in Supabase.

## Was wurde gebaut / Stand 17.07.2026

| Komponente | Wo | Status |
|---|---|---|
| Workflow **„Bege \| HW-01 Instandhaltung → Easybill"** | n8n-Projekt „Bege", ID `x3VnwfVHMnCOfuvi` | ✅ an echtes Formular angepasst, Trigger aufs echte Sheet verdrahtet, Sätze verifiziert, **inaktiv** |
| Workflow **„Bege \| HW-02 Reprocess (Instandhaltung)"** | gleiches Projekt, ID `FTxrBxjV24y2GVDd` | ✅ unverändert gültig (spielt gespeicherte Payloads ab) |
| Tabelle **`maintenance_invoices`** (Protokoll/Idempotenz) | Supabase „Jonas rechnungsworkflow" (`hzeephtezapvgouguigz`) | ✅ |
| **`object_street_map`** + View **`object_street_owner`** (Adress-Matching) | Supabase | ✅ NEU 17.07.: 134 Zuordnungen, Funktion `street_key()` |
| Testkunde **„ZZZ TEST – NICHT VERWENDEN"** | Easybill Jonas, Kunden-ID `2646068990`, E-Mail info@ela-immo.de | ✅ angelegt 17.07. |
| Test-Sheet + Test-Drive-Ordner | Sheet `1zqUokqPY0eOxcmTASvq8VD7KVh0LucwXdfkyLINzgXw` (8 Testfälle), Ordner `1ql4cxT4Mt9UkuoPjk1k3xyOJXSIMQDjH` | ✅ angelegt 17.07. |
| Test-Klon **„ZZ TEST HW-01 (ELA E2E)"** | n8n „Ai Agentur", ID `hqpKuLxxd6zbQ0oX` | ✅ **E2E-Test GRÜN am 17.07.** (Rechnungen 202611129/202611130 im ELA-Konto, Versand an info@ela-immo.de, PDFs in Drive) |
| Hilfs-Workflows „ZZ TEST Setup v2" / „ZZ TMP Easybill Doku-Check" | n8n „Ai Agentur", IDs `kJdlbcS4MDQoWneU` / `icjWeUrsVUte0TLJ` | nach Abschluss archivieren |

## Wichtigste Änderungen vom 17.07. (echtes Formular ≠ Konzept-Annahmen)

1. **Keine „Stunden"-Spalte im Formular** → Arbeitszeit = Endzeit − Startzeit. Fehlende/inkonsistente Zeiten ⇒ HOLD.
2. **Keine „Materialkosten"-Spalte** → Beleg vorhanden (Ja/Upload/Click&Collect) ⇒ HOLD + Mail „Material manuell abrechnen". **Empfehlung: Betragsspalte „Materialkosten (EUR)" ins Formular aufnehmen** — der Workflow nutzt sie dann automatisch.
3. **Einsatzort ist Freitext-Adresse** → neues Straßen-Schlüssel-Matching (`street_key()`: „Alemannenstr 19 1 OG Mitte" → `alemannen 19`) gegen `object_street_owner`. Kein Treffer/mehrdeutig ⇒ HOLD mit Pflege-Hinweis. Abdeckungstest mit ~75 echten Schreibweisen: ~40 eindeutige Treffer, Rest kontrolliert HOLD/Skip.
4. **Eigenbestand**: Objekte der Bege Apartments GmbH selbst (Eugen-Richter-Str. 86, Alemannenstr. 19, Hohenzollernstr. 50, …) erzeugen **keine Rechnung an sich selbst** — Status `skipped_internal`, kein Mail-Alarm (Config `SELF_OWNER_IDS`, bei Bedarf leeren).
5. **Sätze VERIFIZIERT** anhand der manuellen Easybill-Rechnungen 202611301/302/304/305/426: **30,00 €/h**, **0,45 €/km**, Material 1:1, 19 % USt (die alten Platzhalter 45 €/0,50 € wären falsch gewesen!).
6. km-Parser für echte Eingaben („6,5 km", „2+21", „Keine"), Tippfehler-Aliasse für 3 bekannte Falschschreibweisen.

## Ablauf HW-01 (pro neuer Formular-Zeile)

1. **Google-Sheets-Trigger** (Polling 1 min, nur NEUE Zeilen) auf „Checkliste Instandhaltung – Bege Apartments (Antworten)", Tab „Formularantworten 1".
2. **Normalisieren + Fingerprint**: Spalten-Mapping (exakt + Prefix), Arbeitszeit aus Start/Ende, km-Parser, Straßen-Schlüssel; Zeilen vor `GO_LIVE_TS` werden verworfen.
3. **Claim-Insert** in `maintenance_invoices` — Duplikate (unique `form_submission_id`) stoppen still.
4. **Owner-Lookup**: `object_street_owner` (Straßen-Schlüssel → owner_id, erkennt Mehrdeutigkeit) → `owner_mapping_billing` (easybill_customer_id, Drive-Ordner). OrgaMax-Keys bleiben unsichtbar.
5. **Berechnung + Plausibilität**: Stunden×30 € + km×0,45 € (+ Material, falls Spalte existiert), alles in Cent; ~12 Prüfungen.
6. **Eigenbestand ⇒ `skipped_internal`** (still). **Unplausibel ⇒ `hold`** + E-Mail an info@hostautomation.de. In beiden Fällen keine Rechnung.
7. **Plausibel ⇒ Easybill**: `POST /documents` → `PUT /done` → `POST /send/email` → `GET /pdf`, mit Status-Updates nach jedem Schritt.
8. **Drive-Ablage** in den Eigentümer-Ordner; fehlt der Ordner: `completed_no_drive` + Hinweis-Mail.
9. **Fehlerpfad**: Retry (3×, 5 s) → Status `error` + Alarm-Mail; Rate-Limit-Pacing 30 s pro Zeile.

## 🚀 Rest-Checkliste bis Go-live (Stand 17.07. nachmittags)

1. ✅ Credentials erledigt (Sheets-Trigger mit Projekt „Bege" geteilt und im Trigger gesetzt; „Easybill Ela immo" repariert).
2. ✅ Pipeline-Test + voller E2E-Test GRÜN (17.07.): alle 8 Testfälle korrekt, Rechnungen 202611129/202611130 im ELA-Konto erstellt/festgeschrieben/versendet, PDFs in Drive, Versand ohne `to`-Feld nutzt bestätigt die Kundenadresse. Supabase-Testzeilen bereinigt.
5. **Scharfschalten**: In HW-01 `TEST_MODE: false`, `GO_LIVE_TS` = Aktivierungstag, speichern, Workflow aktivieren. Erste echte Rechnung begleiten. Prüfen, ob der Easybill-Versand ohne `to`-Feld die Kundenadresse nutzt (erwartet, beim ersten Versand verifizieren).
6. Optional: Error-Workflow „Error Handler – Rechnungs-Workflows" (`FSevOW6IDQwnCMvs`) in den Workflow-Einstellungen hinterlegen.
7. `reports/gdrive-luecken-2026-07-07.md` abarbeiten (Drive-Ordner-IDs für 17 Eigentümer, Easybill-IDs für „Martin"/„Mikail k").
8. Formular-Erweiterung mit Jonas klären: Spalte „Materialkosten (EUR)" (macht Material-Automatik möglich).
9. ZZ-TEST-Workflows und Testkunde nach Abschluss archivieren/löschen.

## ⚠️ Betriebsregeln

- **Niemals „Execute workflow" auf dem aktiven HW-01 klicken** — der manuelle Modus emittiert ALLE Sheet-Zeilen. Tests nur über den Test-Klon/Test-Sheet. (Schutzschichten: `GO_LIVE_TS`-Cutoff + Duplikat-Claim.)
- Im Sheet keine Zeilen löschen/mittendrin einfügen; Spalten nicht umbenennen. Formular-Änderungen vorher ankündigen → `COLUMN_MAP` anpassen.
- Status-Bedeutungen: `hold` = fachlich angehalten (Mail kam), `skipped_internal` = Eigenbestand (still), `error` = technisch (HW-02 starten), `completed_no_drive` = Rechnung ok, Ablage fehlt, `sending` = manuell in Easybill prüfen.
- HOLD-Zeilen: Ursache beheben (Sheet/Mapping) und Einsatz **per Formular neu einreichen** — neuer Fingerprint, HW-01 verarbeitet frisch.
- Objekt-Mapping pflegen: `insert into object_street_map (street_key, owner_id, sample_address, source) values (public.street_key('<Adresse>'), '<owner_id>', '<Adresse>', 'manuell');`

## 🔒 Sicherheitsbefunde

Unverändert offen aus dem 07.07. (nicht eigenmächtig geändert, da unbekannte anon-Konsumenten nicht ausgeschlossen): `owner_mapping`/`booking_invoices` sind trotz RLS über die `USING (true)`-Policy + anon-Grants offen (inkl. OrgaMax-Keys); `upsert_booking_invoice` ist SECURITY DEFINER + anon-aufrufbar; 2 SECURITY-DEFINER-Views. Alle neuen Objekte (maintenance_invoices, object_owner_map, object_street_map, object_street_owner) sind korrekt gesperrt. RLS auf `tenants` ist seit 07.07. aktiv.

## Dateien

```
bege-invoice-automation/
├── README.de.md                        ← dieses Runbook
├── config/abrechnung-konfiguration.md  ← alle CONFIG-Schalter (Sätze verifiziert 17.07.)
├── reports/gdrive-luecken-2026-07-07.md
├── supabase/migrations/                ← angewendete Migrationen (Referenz)
│   └── 20260717_1_street_key_matching.sql  ← NEU: Adress-Matching
└── workflows/hw-01-…workflow.ts        ← SDK-Quellcode, Stand 17.07. (= Live-Zustand)
```

## Offene Punkte aus dem Konzept — Stand 17.07.

| Frage (Konzept §9) | Antwort |
|---|---|
| Easybill-API: Erstellung UND Versand automatisierbar? | **Ja** — create → done → send/email → pdf, alles verbaut. |
| Exakte Formularfelder | ✅ Geklärt und verdrahtet (echtes Sheet, Tab „Formularantworten 1"). |
| Stundensatz/km-Pauschale | ✅ **30 €/h, 0,45 €/km** — verifiziert an 5 echten Rechnungen. |
| Material 1:1 oder Aufschlag? | ✅ 1:1 als Sammelposition — aber Formular hat keine Betragsspalte ⇒ vorerst HOLD + manuell; Formular-Erweiterung empfohlen. |
| Umgang mit unvollständigen Eingaben | HOLD + Mail statt Rechnung; Eigenbestand still übersprungen. |
