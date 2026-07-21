# Konfiguration: Instandhaltungs-Sammelabrechnung (HW-01 v3)

Die gesamte fachliche Konfiguration lebt im **CONFIG-Block** ganz oben im Code-Node **„Normalisieren + Fingerprint"** des Workflows „Bege | HW-01 v3 Instandhaltung → Easybill (Sammelabrechnung)" (`UxwJGI9y9f06bpud`). Diese Datei dokumentiert jeden Schalter. **Jede Änderung im Workflow bitte auch hier nachziehen.**

## Sätze & Steuern — ✅ VERIFIZIERT am 17.07.2026

Abgeglichen mit den Easybill-Rechnungen 202611301/302/304/305/426 (7 Stunden-Positionen, 6 km-Positionen, konsistent):

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `RATE_HOUR_CENTS` | `3000` (= **30,00 €/h**) | Netto-Stundensatz in Cent |
| `RATE_KM_CENTS` | `45` (= **0,45 €/km**) | Netto-Kilometerpauschale in Cent |
| `MATERIAL_MARKUP_PCT` | `0` (= 1:1) | Aufschlag auf Material (netto lt. Beleg-KI) in % |
| `VAT_PERCENT` | `19` | USt-Satz je Position |

## Zyklus & Sicherheit

| Schlüssel/Ort | Wert | Bedeutung |
|---|---|---|
| Schedule-Node „Zyklus (greift erst bei Aktivierung)" | 14-tägig, Montag 06:00 | **Zeitzyklus wird später mit Jonas final festgelegt**; greift erst nach Aktivierung des Workflows. Bis dahin: manuell starten. |
| Nodes „Easybill: Festschreiben" + „Easybill: E-Mail-Versand" | **deaktiviert** | **Freigabemodus**: nur ENTWÜRFE, Jonas gibt in Easybill frei. Nach ~5 sauberen Läufen aktivieren = Vollautomatik. |
| `TEST_MODE` | `false` | `true` würde alle Rechnungen an `TEST_CUSTOMER_ID` umleiten (Prefix `[TESTLAUF]`) — im Freigabemodus nicht nötig. |
| `GO_LIVE_TS` | `2026-01-01T00:00:00+01:00` | Nur Notbremse gegen Uralt-Zeilen. Die eigentliche Auswahl läuft über **weiße Zeilen** (grün = abgerechnet) + Fingerprint-Duplikatschutz. |
| `SELF_OWNER_IDS` | `['698cae5ad4b3a26bd8501a83']` | Bege Apartments GmbH (Eigenbestand) ⇒ `skipped_internal`, keine Rechnung, kein Mail-Alarm, Zeile bleibt weiß. |

## Plausibilitäts-Schwellwerte (Verstoß ⇒ HOLD, Zeile bleibt weiß, keine Rechnung)

| Schlüssel | Wert | Prüfung |
|---|---|---|
| `MAX_HOURS` | `16` | Stunden ∈ [0; 16]; Endzeit vor Startzeit ⇒ HOLD |
| `MAX_KM` | `400` | Kilometer ∈ [0; 400] |
| `MAX_MATERIAL_CENTS` | `200000` (2.000 €) | Material (KI-Netto) ≤ 2.000 € |
| `MAX_TOTAL_CENTS` | `500000` (5.000 €) | Summe je Einsatz (netto) ≤ 5.000 €, und > 0 |
| `REQUIRE_RECEIPT_FOR_MATERIAL` | `true` | Materialbetrag ohne Beleg ⇒ HOLD |

Weitere HOLD-Gründe: kein Straßen-Schlüssel bildbar, kein Eintrag in `object_street_owner`, Straßen-Schlüssel mehrdeutig (`owner_count > 1`), `easybill_customer_id` fehlt/nicht numerisch, Zeitstempel/Zeiten unlesbar, Beleg angegeben aber von der KI nicht lesbar.

## Beleg-KI

- Node „Beleg-KI: Auswerten": Anthropic, Modell `claude-sonnet-5`, analysiert das Beleg-Foto (JSON: lesbar, brutto, MwSt, netto, Händler, Belegdatum, Hinweis). **Credential muss noch mit dem Projekt „Bege" geteilt und im Node gewählt werden.**
- Netto-Herleitung („Beleg-KI: Ergebnis"): `netto` → sonst `brutto − MwSt` → sonst `brutto / 1,19`.
- Writeback ins Sheet (Node „KI-Werte ins Sheet", Match über Spalte `Zeitstempel`): `KI Material netto (EUR)`, `KI Beleg brutto (EUR)`, `KI Haendler`, `KI Belegdatum`, `KI Hinweis`. **Braucht ein Google-Sheets-Credential mit Schreibrecht** (wie das Grün-Färben).

## Alerts & Zuordnung

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `ALERT_EMAIL` | `info@hostautomation.de` | Dokumentativ; die Gmail-Nodes (Credential „Hostautomation") haben die Adresse direkt gesetzt — bei Änderung in den Mail-Nodes + hier anpassen |
| `TENANT_ID` | `51573283-ea96-4b74-bf32-7e0ecde3d807` | `tenants`-Zeile „Jonas Bege" |

## Spalten-Mapping (`COLUMN_MAP`) — auf das echte Formular abgestimmt

Zuordnung case-insensitiv (Umlaute → ae/oe/ue), erst exakt, dann als Präfix. Aktuelle Kandidaten je Feld:

| Kanonisches Feld | Kandidaten (Präfix-Match) | Echte Formularspalte |
|---|---|---|
| `submitted_at` (Pflicht) | zeitstempel, timestamp | „Zeitstempel" |
| `einsatz_datum` | datum des einsatzes, datum | „Datum des Einsatzes" |
| `object_reference` (Pflicht) | einsatzort, objekt, wohnung, apartment, listing | „Einsatzort: Objekt / Adresse (…)" |
| `startzeit` / `endzeit` | startzeit / endzeit | „Startzeit (z. B. 9:30)" / „Endzeit (z. B. 17:00)" → Stunden = Differenz |
| `stunden_direkt` | stunden, arbeitsstunden, arbeitszeit (stunden), zeitaufwand | (nicht vorhanden — Fallback, falls das Formular mal eine Stundenspalte bekommt; hätte Vorrang) |
| `kilometer` | gefahrene kilometer, kilometer, gefahrene km, km | „Gefahrene Kilometer (Zahl)" — Summen wie „72+10" und Suffixe wie „6,5 km" werden geparst |
| `material` | materialkosten, material (eur), … | (nicht vorhanden — Material kommt aus der Beleg-KI) |
| `beleg_ja` | beleg beigefuegt | „Beleg beigefügt…" |
| `click_collect` | click & collect, click und collect | „Click & Collect…" |
| `beleg_upload` / `foto_upload` | beleg-upload, beleg upload, beleg hochladen / foto-upload, foto upload | Upload-Spalten (Drive-Links) |
| `hausmeister` | unterschrift, hausmeister, mitarbeiter | „Unterschrift" |

Sind die Pflichtfelder nicht zuordenbar (z. B. nach Umbenennung im Formular), wirft der Workflow einen lauten Fehler + Mail statt falsche Rechnungen zu erzeugen.

## Zahlen-, Zeit- & Farbregeln

- Weiße Zeile = Hintergrund mit r, g, b jeweils > 0.92 (auch „keine Füllung"); alles andere gilt als abgerechnet/markiert. Grün-Färbung durch den Workflow: RGB (0, 0.9, 0.1).
- Deutsche Zahlen: `1,5` → 1.5; `1.234,56` → 1234.56. Uhrzeiten `H:MM[:SS]`; Stunden = Ende − Start (auf 2 Nachkommastellen gerundet).
- Zeitstempel `TT.MM.JJJJ HH:MM:SS` (als +02:00 interpretiert), ISO und Google-Serial als Fallback.
- Idempotenz-Fingerprint: `zeitstempel|objekt|startzeit|endzeit|km` — weiß gebliebene (HOLD-)Zeilen werden bei Folgeläufen still übersprungen; für echtes Reprocess die Supabase-Zeile löschen (→ README).

## Pacing / Easybill-Rate-Limit

Ein Request-Paar pro **Eigentümer** (Sammel-Entwurf + Log), dazwischen **15 s Wait** — sicher für den PLUS-Tarif (10 Requests/min). Bei Aktivierung von Festschreiben+Versand (je +2 Calls) ist 15 s weiterhin ausreichend; bei sehr vielen Eigentümern pro Lauf ggf. auf 30 s erhöhen.
