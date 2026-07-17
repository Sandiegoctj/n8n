# Konfiguration: Instandhaltungs-Abrechnung (HW-01)

Die gesamte fachliche Konfiguration lebt im **CONFIG-Block** ganz oben im Code-Node **„Normalisieren + Fingerprint"** des Workflows „Bege | HW-01 Instandhaltung → Easybill" (`x3VnwfVHMnCOfuvi`). Diese Datei dokumentiert jeden Schalter. **Jede Änderung im Workflow bitte auch hier nachziehen.**

Stand 17.07.2026: An das **echte Formular** angepasst („Checkliste Instandhaltung – Bege Apartments", Sheet `16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU`, Tab „Formularantworten 1", gid 1207695698).

## Sätze & Steuern — ✅ VERIFIZIERT am 17.07.2026

Abgeglichen mit den manuell erstellten Easybill-Instandhaltungs-Rechnungen 202611301, 202611302, 202611304, 202611305, 202611426 (Mai–Juli 2026). Alle Positionen 100 % konsistent.

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `RATE_HOUR_CENTS` | `3000` (= 30,00 €/h) | Netto-Stundensatz in **Cent** (Position „Arbeitszeit", Einheit Std.) |
| `RATE_KM_CENTS` | `45` (= 0,45 €/km) | Netto-Kilometerpauschale in **Cent** (Position „Fahrtkosten", Einheit km) |
| `MATERIAL_MARKUP_PCT` | `0` (= 1:1) | Material wird 1:1 als Sammelposition durchgereicht |
| `VAT_PERCENT` | `19` | Auf allen Positionen (Kleinunternehmer-Regelung galt nur 2023) |

## Sicherheit & Testbetrieb

| Schlüssel | Aktueller Wert | Bedeutung |
|---|---|---|
| `TEST_MODE` | `true` | `true`: Jede Rechnung geht an `TEST_CUSTOMER_ID` statt an den Eigentümer; Titel/Betreff tragen den Prefix `[TESTLAUF]`; PDF landet in `TEST_DRIVE_FOLDER_ID` |
| `TEST_CUSTOMER_ID` | `''` (leer) | Easybill-Kunde für Tests. Angelegt am 17.07.: **„ZZZ TEST – NICHT VERWENDEN" = `2646068990`** (E-Mail info@ela-immo.de) |
| `TEST_DRIVE_FOLDER_ID` | `''` (leer) | Drive-Ordner für Test-PDFs. Angelegt am 17.07.: `1ql4cxT4Mt9UkuoPjk1k3xyOJXSIMQDjH` („ZZ TEST Bege Rechnungen (HW-01)") |
| `SELF_OWNER_IDS` | `['698cae5ad4b3a26bd8501a83']` | **Eigenbestand Bege Apartments GmbH**: Einsätze an eigenen Objekten erzeugen KEINE Rechnung und KEINEN Mail-Alarm, nur Supabase-Status `skipped_internal`. Leeren, falls Jonas Selbst-Fakturierung wünscht. |
| `GO_LIVE_TS` | `2026-07-17T00:00:00+02:00` | Formular-Zeilen mit älterem Zeitstempel werden **ignoriert** (Schutz gegen Alt-Backfill). Beim Go-live auf den Aktivierungstag setzen. |

**Übergabezustand = doppelt gesichert:** Workflow inaktiv **und** `TEST_MODE=true` mit leerer `TEST_CUSTOMER_ID` ⇒ selbst bei versehentlicher Aktivierung wird keine einzige Rechnung erstellt.

## Abgeleitete Werte (neu seit 17.07.)

- **Arbeitszeit** = Endzeit − Startzeit (Spalten „Startzeit"/„Endzeit"; das Formular hat KEINE Stunden-Spalte). Fehlt eine der Zeiten oder ist Ende < Start ⇒ HOLD. Falls später eine „Stunden"-Spalte ins Formular kommt, hat sie Vorrang (`stunden_direkt` in `COLUMN_MAP`).
- **Kilometer**: versteht „6,5 km", „2+21" (Summe), „‚89", „Keine" (= 0). Unlesbares ⇒ HOLD.
- **Material**: Das Formular hat **keine Betragsspalte**. Ist „Beleg beigefügt? = Ja", Click&Collect = Ja oder ein Beleg-Upload vorhanden ⇒ HOLD mit Mail („Material manuell abrechnen"). **Empfehlung: Spalte „Materialkosten (EUR)" ins Formular aufnehmen** — der Workflow nutzt sie dann automatisch (inkl. Beleg-Pflicht via `REQUIRE_RECEIPT_FOR_MATERIAL`).
- **Objekt → Eigentümer**: Straßen-Schlüssel-Matching (Straßenname + Hausnummer, normalisiert) gegen die Supabase-View `object_street_owner` (Tabelle `object_street_map`, 134 Einträge). Kein Treffer oder mehrdeutig (z. B. Bülowstraße 2 mit 2 Eigentümern) ⇒ HOLD. Pflege-SQL siehe `supabase/migrations/20260717_1_street_key_matching.sql`.

## Plausibilitäts-Schwellwerte (Zeile wird bei Verstoß angehalten, keine Rechnung)

| Schlüssel | Aktueller Wert | Prüfung |
|---|---|---|
| `MAX_HOURS` | `16` | Stunden ∈ [0; 16] |
| `MAX_KM` | `400` | Kilometer ∈ [0; 400] |
| `MAX_MATERIAL_CENTS` | `200000` (2.000 €) | Materialkosten ≤ 2.000 € (nur relevant mit Betragsspalte) |
| `MAX_TOTAL_CENTS` | `500000` (5.000 €) | Gesamtsumme (netto) ≤ 5.000 €, und > 0 |
| `REQUIRE_RECEIPT_FOR_MATERIAL` | `true` | Materialbetrag > 0 ohne Beleg-Upload ⇒ HOLD |

Weitere automatische HOLD-Gründe: kein Straßen-Schlüssel bildbar (kein Straßenname+Hausnummer im Einsatzort), kein/mehrdeutiges Eigentümer-Mapping, fehlende `easybill_customer_id`, unlesbarer Zeitstempel, fehlende/inkonsistente Zeiten.

## Alerts & Zuordnung

| Schlüssel | Aktueller Wert | Bedeutung |
|---|---|---|
| `ALERT_EMAIL` | `info@hostautomation.de` | Dokumentativ; die Gmail-Nodes haben die Adresse direkt gesetzt |
| `TENANT_ID` | `51573283-ea96-4b74-bf32-7e0ecde3d807` | `tenants`-Zeile „Jonas Bege" |

## Spalten-Mapping (`COLUMN_MAP`) — an die echten Überschriften angepasst (17.07.)

Matching: erst exakt, dann **Prefix** gegen die normalisierten Überschriften (lowercase, ä→ae … ß→ss, Leerzeichen kollabiert). Die echten Spalten des Formulars:

| Kanonisches Feld | Echte Spalte |
|---|---|
| `submitted_at` (Pflicht) | Zeitstempel |
| `einsatz_datum` | Datum des Einsatzes (für Rechnungstext; Fallback Zeitstempel) |
| `object_reference` (Pflicht) | Einsatzort: Objekt / Adresse (Stadt + Straße + Etage) |
| `startzeit` / `endzeit` | Startzeit (z. B. 9:30) / Endzeit (z. B. 17:00) |
| `kilometer` | Gefahrene Kilometer (Zahl) |
| `kategorie` | Kategorie der Aufgabenmeldung |
| `beschreibung` | Was wurde gemacht / festgestellt? |
| `beleg_ja` | Beleg beigefügt? * |
| `click_collect` | Click & Collect Bestellung (z. B. IKEA)? |
| `beleg_upload` | Beleg-Upload (Pflicht bei 'Ja' oben) |
| `foto_upload` | Foto-Upload (…) |
| `hausmeister` | Unterschrift (Mitarbeiter) |
| `stunden_direkt` / `material` | reserviert für künftige Formular-Spalten „Stunden" / „Materialkosten (EUR)" |

Sind die **Pflichtfelder** nicht zuordenbar, wirft der Workflow einen lauten Fehler statt falsche Rechnungen zu erzeugen — nach einer Formular-Änderung also zuerst `COLUMN_MAP` erweitern.

## Zahlen- & Datumsformate

- Deutsche Zahlen werden geparst: `1,5` → 1.5; €/km/Std-Suffixe werden entfernt.
- Zeitstempel: `TT.MM.JJJJ[ HH:MM[:SS]]` (als +02:00 interpretiert), ISO-Strings und Google-Serial-Zahlen als Fallback.
- Idempotenz-Fingerprint: `zeitstempel|objekt|startzeit|endzeit|km_raw` — identische Doppel-Einreichungen werden still verworfen (unique constraint), korrigierte Neueinreichungen erzeugen einen neuen Fingerprint.

## Pacing / Easybill-Rate-Limit

Der Loop verarbeitet Zeilen einzeln mit **30 s Wartezeit** — sicher für den PLUS-Tarif (10 Requests/min; ~5 Calls pro Rechnung). Bei BUSINESS-Tarif (60/min) kann der Wait auf 6–10 s gesenkt werden.
