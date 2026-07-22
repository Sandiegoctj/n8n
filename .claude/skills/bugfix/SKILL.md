---
name: bugfix
description: Bugfix nach Host-Automation-Playbook (Prozess C). Nutzen, wenn ein Bug gefixt werden soll — mit Linear-Ticket-ID (z. B. /bugfix HOS-14) oder mit Fehlerbeschreibung/Screenshot.
---

Fixe den gemeldeten Bug nach unserem Standard-Ablauf:

1. **Kontext holen:** Wenn eine Ticket-ID (HOS-…) übergeben wurde und Linear verbunden ist: Ticket lesen und auf „In Progress" setzen. Fehlen Repro-Schritte, Erwartet/Tatsächlich oder der betroffene Tenant → aktiv nachfragen, bevor du baust.
2. **Reproduzieren** auf dem Demo-/Test-Tenant. Nicht reproduzierbar → dokumentieren, welche Infos fehlen, und stoppen.
3. **Root Cause finden** — Ursache statt Symptom (kein „Reset und gut").
4. **Fix bauen** nach den eisernen Regeln aus CLAUDE.md (TEST-Kopie bei n8n, kein Prod-Edit, nichts löschen).
5. **Testen:** Repro-Schritte erneut durchlaufen → Fehler weg. Bei buchungsnahen Themen die relevanten Zeilen der Edge-Case-Matrix prüfen. Kurzer Regressionscheck der angrenzenden Funktionen.
6. **Protokoll** als Markdown: Root Cause in 3 Sätzen · „Welcher Test hätte das gefangen?" (Vorschlag für die Regressionsliste) · Testergebnisse Grün/Rot mit Belegen · offene manuelle Prüfpunkte für den Menschen.
7. **Abschluss:** Protokoll als Linear-Kommentar, Status „In Review". Deploy nur im Releasefenster. Niemals selbst auf „Done".
