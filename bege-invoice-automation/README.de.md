# Automatisierte Instandhaltungs-Abrechnung – Bege Apartments

Stand **21.07.2026**. Umsetzung des Konzepts v0.1 (07.07.2026), weiterentwickelt nach Jonas' echtem Prozess: Das Hausmeister-Formular schreibt ins Antwort-Sheet, **weiße Zeilen = offen, grüne Zeilen = abgerechnet**. Der Workflow läuft im **Zeitzyklus** (Standard: 14-tägig, final noch festzulegen), erstellt **eine Sammelrechnung je Eigentümer** über alle offenen Einsätze und färbt die abgerechneten Zeilen grün. Beleg-Fotos aus dem Formular wertet eine **Beleg-KI** aus und trägt die Werte ins Sheet ein. **Übergabe erfolgt inaktiv** — Aktivierung erst nach der Checkliste unten.

## Was ist aktuell (v3) — und was ist Alt-Bestand

| Komponente | Wo | Status |
|---|---|---|
| **„Bege \| HW-01 v3 Instandhaltung → Easybill (Sammelabrechnung)"** | n8n, Projekt „Bege", ID `UxwJGI9y9f06bpud` (40 Nodes) | ✅ **AKTUELLER Workflow**, Pin-Test grün (Execution 183539), **inaktiv** |
| „ZZ ALT \| HW-01 v1 Einzelrechnung" | n8n, ID `x3VnwfVHMnCOfuvi` | 🗄️ ersetzt durch v3, **nicht aktivieren**, nur Referenz |
| „Bege \| HW-02 Reprocess" | n8n, ID `FTxrBxjV24y2GVDd` | 🗄️ stammt aus dem v1-Modell; im v3-Modell ist Reprocess einfacher (s. unten) |
| Tabelle `maintenance_invoices` (Protokoll/Idempotenz) | Supabase „Jonas rechnungsworkflow" (`hzeephtezapvgouguigz`) | ✅ RLS aktiv, anon gesperrt |
| View `owner_mapping_billing` (nur Abrechnungs-Spalten, keine OrgaMax-Keys) | Supabase | ✅ |
| Objekt→Eigentümer: Tabelle `object_street_map` + View `object_street_owner` (Street-Key-Matching) | Supabase | ✅ 134 Straßen-Schlüssel, ⚠️ 7 mehrdeutig (gehören zu 2 Eigentümern → HOLD, bis bereinigt) |
| RLS-Fix `tenants` | Supabase | ✅ |
| Google-Sheet „Checkliste Instandhaltung – Bege Apartments (Antworten)" | Doc `16rxquK3LlXBMWBRNQuY-khjbV86wXOwB8OBf-ESN1HU`, Blatt „Formularantworten 1" | ✅ im Workflow verdrahtet |

## Prozessmodell v3 (ein Abrechnungslauf)

1. **Start**: manuell („Start Abrechnungslauf") oder Zeitplan-Trigger (aktuell 14-tägig Montag 06:00 — greift erst, wenn der Workflow aktiviert wird; **der endgültige Zyklus wird später festgelegt**).
2. **Sheet lesen inkl. Zellfarben** (Google Sheets API mit `includeGridData`): Nur **weiße** Zeilen (Hintergrund nahe Weiß) werden verarbeitet — grüne sind bereits abgerechnet.
3. **Normalisieren + Fingerprint**: Spalten-Mapping auf das echte Formular (Einsatzort-Adresse, Start-/Endzeit → Stunden, Kilometer inkl. Summen wie „72+10", deutsche Zahlen). Fingerprint `zeitstempel|objekt|startzeit|endzeit|km` → unique in `maintenance_invoices`; Duplikate (z. B. weiß gebliebene HOLD-Zeilen) stoppen still, keine Doppel-Mails.
4. **Beleg-KI** (wenn im Formular ein Beleg-Foto hochgeladen wurde): Foto aus Drive laden → Claude (`claude-sonnet-5`) liest Netto/Brutto/MwSt, Händler, Belegdatum → Werte werden als Spalten **„KI Material netto (EUR)", „KI Beleg brutto (EUR)", „KI Haendler", „KI Belegdatum", „KI Hinweis"** in die Sheet-Zeile geschrieben (Match über Zeitstempel) und fließen als Material-Position in die Rechnung. Unlesbarer Beleg ⇒ HOLD statt Rechnung.
5. **Zuordnung**: Einsatzort → Straßen-Schlüssel (`street_key`) → `object_street_owner` → `owner_mapping_billing` (easybill_customer_id, Drive-Ordner). OrgaMax-Keys bleiben unsichtbar (nur View).
6. **Berechnung + Plausibilität** (je Einsatz): Stunden × 30,00 € + km × 0,45 € + Material (netto lt. Beleg-KI), 19 % USt — **Sätze am 17.07.2026 anhand der Easybill-Rechnungen 202611301/302/304/305/426 verifiziert**. ~10 Prüfungen (Grenzen, Mapping gefunden, Zeiten lesbar, Beleg-Pflicht bei Material …).
7. **Unplausibel ⇒ HOLD**: Supabase-Status `hold` + Mail an info@hostautomation.de, **Zeile bleibt weiß**, keine Rechnung. Eigenbestand (Bege selbst, `SELF_OWNER_IDS`) ⇒ `skipped_internal` ohne Mail-Alarm.
8. **Sammelrechnung**: Alle plausiblen Einsätze werden **je Eigentümer gruppiert** → **ein** Easybill-Dokument mit Positionen pro Einsatz (chronologisch, Zeitraum im Rechnungstext) → `POST /documents` (Entwurf).
9. **Grün färben**: Nach erfolgreichem Entwurf werden genau die abgerechneten Sheet-Zeilen per `batchUpdate` grün gefärbt; alle zugehörigen Supabase-Zeilen erhalten `invoice_created` + Dokument-ID.
10. **Freigabemodus** ⚠️: Die Nodes **„Easybill: Festschreiben"** und **„Easybill: E-Mail-Versand"** sind **deaktiviert** ⇒ es entstehen nur **ENTWÜRFE**; Jonas prüft, schreibt fest und versendet in Easybill. Nach ~5 sauberen Läufen beide Nodes aktivieren = Vollautomatik.
11. **Abschluss**: 15 s Pacing je Eigentümer (Easybill-Rate-Limit), dann Zusammenfassungs-Mail (Anzahl Entwürfe, Einsätze, Summe je Eigentümer).

## Reprocess im v3-Modell

- **HOLD-Zeile** (bleibt weiß): Ursache beheben (Sheet-Werte, Mapping, Beleg). Ändert die Korrektur Zeitstempel/Objekt/Zeiten/km, entsteht ein neuer Fingerprint → nächster Lauf verarbeitet automatisch. Sonst (z. B. nur Mapping gepflegt): zugehörige `maintenance_invoices`-Zeile **löschen** und den nächsten Lauf starten — die weiße Zeile wird wieder aufgegriffen.
- **Technischer Fehler** (`status=error` + Mail): gleiche Regel — Supabase-Zeile löschen, Lauf neu starten. Vorsicht nur, wenn bereits eine `easybill_document_id` geloggt ist: erst in Easybill prüfen (Entwurf ggf. löschen), sonst entsteht ein zweiter Entwurf.
- HW-02 (`FTxrBxjV24y2GVDd`) stammt aus dem v1-Einzelrechnungs-Modell und wird für v3 normalerweise nicht gebraucht.

## 🚀 Checkliste bis zur Aktivierung (in dieser Reihenfolge)

1. **Anthropic-Credential** in den n8n-Credential-Einstellungen **mit dem Projekt „Bege" teilen** und im Node **„Beleg-KI: Auswerten"** auswählen. (Bis dahin: Beleg-Zeilen laufen auf HOLD — es geht nichts verloren.)
2. **Google-Sheets-Credential mit Schreibrecht** (Typ „Google Sheets OAuth2", nicht der Trigger-Typ) mit dem Projekt „Bege" teilen und in den Nodes **„KI-Werte ins Sheet"** und **„Sheet: Zeilen GRUEN faerben"** auswählen. Das Konto braucht Bearbeiter-Zugriff aufs Antwort-Sheet. (Bis dahin schlägt das Färben fehl ⇒ Fehler-Mail; Rechnungs-Entwürfe entstehen trotzdem — vor dem nächsten Lauf Zeilen dann manuell grün färben, sonst würden sie erneut gelesen und nur durch den Duplikat-Schutz gestoppt.)
3. **Drive-Credential prüfen**: Im Node „Beleg laden (Drive)" ist „Ela immbilien GmbH" gewählt — testweise ein Formular-Beleg-Foto öffnen lassen; hat das Konto keinen Zugriff auf die Upload-Dateien des Formulars, korrektes Credential teilen/wählen.
4. **7 mehrdeutige Straßen-Schlüssel bereinigen** (`select * from object_street_owner where owner_count > 1`): je Adresse den richtigen Eigentümer in `object_street_map` festlegen — bis dahin laufen Einsätze an diesen Adressen auf HOLD.
5. **Erster echter Lauf**: Workflow **manuell** starten („Start Abrechnungslauf"). Ergebnis: Easybill-**Entwürfe** + grüne Zeilen + Zusammenfassungs-Mail. Entwürfe mit Jonas centgenau gegenprüfen.
6. **Zyklus festlegen** (mit Jonas): Schedule-Node „Zyklus (greift erst bei Aktivierung)" anpassen (aktuell 14-tägig Mo 06:00) und den Workflow **aktivieren**.
7. Nach ~5 sauberen Läufen: Nodes „Easybill: Festschreiben" + „Easybill: E-Mail-Versand" aktivieren ⇒ Vollautomatik inkl. Versand. (Der Versand nutzt die beim Easybill-Kunden hinterlegte E-Mail-Adresse.)
8. `reports/gdrive-luecken-2026-07-07.md` abarbeiten (Drive-Ordner-/Easybill-ID-Lücken in `owner_mapping`; Drive-Ablage der PDFs ist in v3 noch nicht wieder eingebaut — kommt, sobald die Ordnerstruktur-Frage geklärt ist).

## ⚠️ Betriebsregeln

- **Grün ist das Abrechnungs-Signal**: Zeilen niemals manuell grün färben, solange sie nicht abgerechnet sind — und abgerechnete niemals wieder weiß machen (sonst doppelte Verarbeitung, die nur noch der Duplikat-Schutz abfängt). Beim manuellen Färben immer die **ganze Zeile** färben: Eine nur teilweise gefärbte Zeile wird sicherheitshalber übersprungen (weder abgerechnet noch grün gefärbt), bis sie eindeutig ist.
- Spaltenüberschriften im Formular/Sheet nicht umbenennen (lauter Stopp mit Fehler-Mail); neue Spalten sind unkritisch. Die KI-Spalten (`KI …`) gehören dem Workflow.
- Eigenbestand-Zeilen (Bege selbst) werden **nicht** gefärbt und nicht berechnet (`skipped_internal`) — sie bleiben weiß und werden bei Folgeläufen still übersprungen; bei Bedarf manuell andersfarbig markieren.
- Ein manueller Start ist jederzeit gefahrlos: Er verarbeitet nur weiße Zeilen und stoppt Duplikate still (anders als v1 gibt es keinen „alle Zeilen"-Massenmodus mehr).
- Status-Bedeutungen in `maintenance_invoices`: `hold` = fachlich angehalten (Mail kam, Zeile weiß), `skipped_internal` = Eigenbestand, `error` = technisch (Mail kam), `invoice_created` = im Sammel-Entwurf enthalten.

## 🔒 Sicherheitsbefunde (über das Konzept hinaus; nicht eigenmächtig geändert)

1. **`owner_mapping` und `booking_invoices` sind trotz RLS praktisch offen**: Policy „Service role full access" gilt mit `USING (true)` für alle Rollen + volle anon/authenticated-Grants ⇒ OrgaMax-API-Keys und Gästedaten sind mit dem anon-Key les- und schreibbar. Fix (sobald bestätigt ist, dass keine externe App den anon-Key nutzt): Policy auf `to service_role` einschränken bzw. streichen und `revoke all … from anon, authenticated`.
2. `upsert_booking_invoice` ist SECURITY DEFINER und für anon per RPC aufrufbar.
3. Views `v_pending_ota_invoices` / `v_invoices_to_cancel` sind SECURITY DEFINER (Advisor-ERROR).
4. Alle Objekte dieses Projekts (maintenance_invoices, object_street_map, owner_mapping_billing) sind korrekt gesperrt; `tenants`-RLS wurde aktiviert und per Advisor verifiziert.

## Dateien

```
bege-invoice-automation/
├── README.de.md                          ← dieses Runbook (v3)
├── config/abrechnung-konfiguration.md    ← alle CONFIG-Schalter (Sätze VERIFIZIERT)
├── reports/gdrive-luecken-2026-07-07.md  ← Lücken in owner_mapping (Drive/Easybill-IDs)
├── supabase/migrations/                  ← angewendete Migrationen vom 07.07. (Referenz;
│                                           Street-Key-Matching kam später direkt auf der Instanz dazu)
└── workflows/
    ├── hw-01-v3-sammelabrechnung.workflow.ts   ← AKTUELL (UxwJGI9y9f06bpud)
    ├── hw-01-instandhaltung-easybill.workflow.ts  ← v1, ersetzt (Referenz)
    └── hw-02-reprocess.workflow.ts               ← v1-Begleiter, ersetzt (Referenz)
```
