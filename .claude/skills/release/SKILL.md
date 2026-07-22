---
name: release
description: Release durchführen mit Release-Checkliste und Smoke-Test (Playbook §6.4/§6.5). Nutzen für jedes Deployment, z. B. /release CleanFlow.
---

Führe das Release strikt nach Checkliste durch — brich ab und melde dich, wenn ein Punkt nicht erfüllbar ist:

1. **Vorab prüfen:** Testprotokoll vorhanden? Vier-Augen-Verifikation im Ticket vermerkt? Releasefenster eingehalten (Mo–Do vor 16 Uhr, kein Kundentermin unmittelbar danach)? Wenn nein → stoppen und den Menschen fragen.
2. **Rollback sichern:** Aktuelle Version notieren (n8n-Workflow-Version bzw. Git-Commit).
3. **Deploy.**
4. **Smoke-Test (~10 min):** Host-Login · Reinigungskraft-Login (App!) · Dashboard lädt mit heutigen Aufträgen · Auftrag öffnen, Checkliste sichtbar und abhakbar · Testbuchung anlegen → Auftrag entsteht · Testbuchung stornieren → Auftrag verschwindet, keine Nachricht geht raus · Testnachricht an Team-Nummer (Absendername + Sprache korrekt) · Problem melden → Benachrichtigung kommt an · keine neuen Fehler in n8n-Executions/Sentry/Konsole.
5. **Protokoll:** Ergebnis je Punkt + Rollback-Info als Linear-Kommentar. Bei Rot → sofort Rollback und den Menschen informieren.
6. Zum Schluss erinnern: Morgencheck am Folgetag (David).
