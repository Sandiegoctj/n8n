# Host Automation — Arbeitsregeln für Claude Code (Delivery-Playbook v1.0, Stand 18.07.2026)

## Kontext
- Host Automation: Workflow-Automatisierung & Custom-Software für Kurzzeitvermietung (DACH). Niemand im Team liest oder schreibt Code — DU baust, Menschen verifizieren das Verhalten.
- Systeme: n8n Cloud (per MCP), Supabase Multi-Tenant (per MCP; Tenants u. a. ELA, Demo/Test, Jonas Bege, TZ Immobilien, Alpena, Wohnkultur), Next.js/Turborepo (CleanFlow), Easybill/OrgaMax, WhatsApp via 360dialog, Linear als Ticketsystem (per MCP, falls verbunden).

## Eiserne Regeln (gelten IMMER, ohne Ausnahme)
1. NIE in Produktion testen. Tests nur auf dem Demo-/Test-Tenant. Nachrichten-Tests nur an Team-Nummern (Whitelist) bzw. im TEST_MODE. Niemals echte Gastnummern oder Gastdaten für Tests verwenden.
2. Nichts löschen — weder Daten noch Workflows noch Tabellen. Statt löschen: deaktivieren/archivieren und im Ticket vermerken.
3. Produktiv-Workflows in n8n nie live editieren: Kopie „TEST — {Name}" anlegen, dort mit Pin-Data gegen den Demo-Tenant bauen und testen; Änderungen erst im Releasefenster übertragen. Vor jeder Änderung die aktuelle Workflow-Version notieren (Rollback-Pfad).
4. Rechnungs- und Versand-Workflows gehen neu IMMER erst im Hold-Modus live: Entwurf statt Versand, die ersten ~5 Vorgänge werden manuell freigegeben. Umschalt-Flag dokumentieren.
5. Releasefenster: Montag–Donnerstag vor 16 Uhr. Kein Deploy freitags nachmittags oder unmittelbar vor Kundenterminen.
6. Jede Änderung kurz begründen (was, warum) und Belege liefern: n8n-Execution-Links, Screenshots, Log-Auszüge.
7. Secrets und API-Keys niemals in Ausgaben, Logs oder Commits.

## Definition of Done — „fertig" heißt:
- Läuft auf dem Test-Tenant und ist gegen die Akzeptanzkriterien des Tickets getestet
- Edge-Case-Matrix geprüft, wenn das Thema an Buchungen hängt (siehe unten)
- Testprotokoll als Markdown: pro Punkt Grün/Rot mit Beleg-Link
- Explizite Liste, was NICHT automatisch getestet werden konnte → muss ein Mensch prüfen
- Die finale Abnahme macht immer ein Mensch (Vier-Augen-Prinzip). Du meldest nie „fertig" ohne diese Nachweise.

## Edge-Case-Matrix Buchungs-Lifecycle (Pflicht bei allem Buchungsnahen)
Neue Buchung · Datumsänderung · Zimmer-/Einheitenwechsel · STORNO (Auftrag entfernt? keine Nachrichten mehr?) · UMBUCHUNG (alte Trigger tot, neue korrekt?) · Late-Check-out/Early-Check-in (Zeiten folgen?) · Langzeitbuchung (keine Geister-Aufträge?) · Gast ohne Handynummer/Festnetz (Fallback greift?) · Fremdsprachiger Gast (Sprache bleibt?) · Buchung direkt im PMS angelegt · Doppel-/Parallelbuchung

## Linear-Arbeitsablauf (wenn Linear-MCP verbunden)
1. Ticket holen → Status „In Progress"
2. Arbeiten nach den Regeln oben
3. Ergebnis + Testprotokoll als Kommentar ins Ticket (inkl. Beleg-Links)
4. Status auf „In Review" setzen — NIEMALS selbst auf „Done" (Done setzt der Mensch nach Verifikation)
Ohne Linear-Zugriff: gleiche Schritte, Protokoll als Markdown ausgeben.

## Referenzen — zentrale n8n-Workflow-IDs
CleanFlow Core `iwczyVQb7ctu4Lxc` · InvoiceFlow `EnOR52zKBKT70uCi` · Owner Statements `oPvpi8Dq51E9A09M` · Apaleo↔CleanFlow Sync (TZ) `5dLh2gEILkYNQDsd` · WhatsApp-Notification `0wbVoBFJTixGF9g1` · Guesty OAuth Refresh `z6Sv05uHX3Ov80sp`
