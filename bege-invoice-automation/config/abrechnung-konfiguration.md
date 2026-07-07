# Konfiguration: Instandhaltungs-Abrechnung (HW-01)

Die gesamte fachliche Konfiguration lebt im **CONFIG-Block** ganz oben im Code-Node **„Normalisieren + Fingerprint"** des Workflows „Bege | HW-01 Instandhaltung → Easybill" (`x3VnwfVHMnCOfuvi`). Diese Datei dokumentiert jeden Schalter. **Jede Änderung im Workflow bitte auch hier nachziehen.**

## Sätze & Steuern — ⚠️ PLATZHALTER, vor Go-live zwingend verifizieren!

| Schlüssel | Aktueller Wert | Bedeutung |
|---|---|---|
| `RATE_HOUR_CENTS` | `4500` (= 45,00 €/h) | Netto-Stundensatz in **Cent** |
| `RATE_KM_CENTS` | `50` (= 0,50 €/km) | Netto-Kilometerpauschale in **Cent** |
| `MATERIAL_MARKUP_PCT` | `0` (= 1:1 durchgereicht) | Aufschlag auf Materialkosten in % |
| `VAT_PERCENT` | `19` | USt-Satz je Position |

Verifikation (Go-live-Checkliste): 3–5 historische Sheet-Einträge mit den zugehörigen Easybill-Rechnungen abgleichen (Positionspreise, USt, Rundung) und die Werte hier + im Workflow festschreiben. Easybill rechnet in **Cent** (`single_price_net`), genau wie dieser Workflow — der Vergleich ist centgenau möglich.

## Sicherheit & Testbetrieb

| Schlüssel | Aktueller Wert | Bedeutung |
|---|---|---|
| `TEST_MODE` | `true` | `true`: Jede Rechnung geht an `TEST_CUSTOMER_ID` statt an den echten Eigentümer; Titel/Betreff tragen den Prefix `[TESTLAUF]` |
| `TEST_CUSTOMER_ID` | `''` (leer) | Easybill-Kunden-ID des Testkunden (Empfehlung: eigenen Kunden „ZZZ TEST – NICHT VERWENDEN" mit Jonas' E-Mail anlegen) |
| `GO_LIVE_TS` | `2026-07-07T00:00:00+02:00` | Formular-Zeilen mit älterem Zeitstempel werden **ignoriert** (Schutz gegen Alt-Backfill). Beim Go-live auf den Aktivierungstag setzen. |

**Übergabezustand = doppelt gesichert:** Workflow inaktiv **und** `TEST_MODE=true` mit leerer `TEST_CUSTOMER_ID` ⇒ selbst bei versehentlicher Aktivierung wird keine einzige Rechnung erstellt — jede Zeile läuft auf HOLD mit E-Mail-Alert.

## Plausibilitäts-Schwellwerte (Zeile wird bei Verstoß angehalten, keine Rechnung)

| Schlüssel | Aktueller Wert | Prüfung |
|---|---|---|
| `MAX_HOURS` | `16` | Stunden ∈ [0; 16] |
| `MAX_KM` | `400` | Kilometer ∈ [0; 400] |
| `MAX_MATERIAL_CENTS` | `200000` (2.000 €) | Materialkosten ≤ 2.000 € |
| `MAX_TOTAL_CENTS` | `500000` (5.000 €) | Gesamtsumme (netto) ≤ 5.000 €, und > 0 |
| `REQUIRE_RECEIPT_FOR_MATERIAL` | `true` | Material > 0 ohne Beleg-Upload ⇒ HOLD |

Weitere automatische HOLD-Gründe: Objekt nicht in `object_owner_map`, fehlende/nicht-numerische `easybill_customer_id`, unlesbarer Zeitstempel, ungültige Zahlenwerte.

## Alerts & Zuordnung

| Schlüssel | Aktueller Wert | Bedeutung |
|---|---|---|
| `ALERT_EMAIL` | `info@hostautomation.de` | Dokumentativ; die Gmail-Nodes haben die Adresse direkt gesetzt (bei Änderung: in den 3 Mail-Nodes + hier anpassen) |
| `TENANT_ID` | `51573283-ea96-4b74-bf32-7e0ecde3d807` | `tenants`-Zeile „Jonas Bege" |

## Spalten-Mapping (`COLUMN_MAP`) — bei Verdrahtung des echten Sheets prüfen!

Der Workflow ordnet Formular-Spalten **case-insensitiv** (Umlaute → ae/oe/ue) über Kandidatenlisten zu. Aktuelle Kandidaten:

| Kanonisches Feld | Akzeptierte Spaltenüberschriften |
|---|---|
| `submitted_at` (Pflicht) | zeitstempel, timestamp, datum |
| `object_reference` (Pflicht) | objekt, wohnung, apartment, listing, objekt / wohnung, welche wohnung, welches objekt |
| `hausmeister` | hausmeister, name, mitarbeiter |
| `stunden` | stunden, arbeitszeit (stunden), arbeitsstunden, zeitaufwand (stunden), zeitaufwand, arbeitszeit |
| `kilometer` | kilometer, gefahrene kilometer, km, gefahrene km |
| `material` | materialkosten, materialkosten (eur), material (eur), material, materialkosten in eur |
| `belege` | beleg, belege, beleg-upload, belege (upload), quittung, beleg hochladen |
| `beschreibung` | beschreibung, was wurde gemacht, taetigkeit, arbeitsbeschreibung, bemerkung, was wurde repariert |

Sind die **Pflichtfelder** nicht zuordenbar, wirft der Workflow einen lauten Fehler (Error-Workflow/Mail) statt falsche Rechnungen zu erzeugen — nach einer Formular-Änderung also zuerst `COLUMN_MAP` erweitern.

## Zahlen- & Datumsformate

- Deutsche Zahlen werden geparst: `1,5` → 1.5; `1.234,56` → 1234.56; €/Einheiten-Suffixe werden entfernt.
- Zeitstempel: `TT.MM.JJJJ[ HH:MM[:SS]]` (Google-Forms-Standard, als +02:00 interpretiert — im Winter 1 h Abweichung, für den Cutoff unerheblich), ISO-Strings und Google-Serial-Zahlen als Fallback.
- Idempotenz-Fingerprint: `zeitstempel|objekt|stunden|km|material` — identische Doppel-Einreichungen werden still verworfen (unique constraint), inhaltlich korrigierte Neueinreichungen erzeugen einen neuen Fingerprint und werden verarbeitet.

## Pacing / Easybill-Rate-Limit

Der Loop verarbeitet Zeilen einzeln mit **30 s Wartezeit** („Pacing (Rate-Limit)"-Node) — sicher für den PLUS-Tarif (10 Requests/min; ~5 Calls pro Rechnung). Bei BUSINESS-Tarif (60/min) kann der Wait auf 6–10 s gesenkt werden. Tarif im Easybill-Konto prüfen.
