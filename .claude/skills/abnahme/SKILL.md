---
name: abnahme
description: Interne Abnahme vorbereiten — Testprotokoll gegen Akzeptanzkriterien und Definition of Done erstellen. Nutzen vor jedem Kundentermin oder Go-live (z. B. /abnahme HOS-9).
---

Bereite die interne Abnahme vor:

1. Akzeptanzkriterien aus Ticket/PRD ziehen. Fehlen sie → aus dem Kontext plausible Kriterien vorschlagen und bestätigen lassen.
2. Jeden Punkt auf dem Test-Tenant durchtesten; buchungsnahe Themen vollständig gegen die Edge-Case-Matrix.
3. Smoke-Kurzcheck: Logins beider Rollen (Host + Reinigungskraft), Kernfluss einmal komplett, keine neuen Fehler in n8n-Executions/Konsole.
4. **Abnahme-Protokoll** als Markdown: pro Kriterium Grün/Rot mit Beleg · Restrisiken · Liste der manuellen Prüfpunkte, so aufbereitet, dass der Mensch sie in max. 30 Minuten durchklicken kann.
5. Protokoll ins Ticket, Status „In Review". Die Grün/Rot-Gesamtentscheidung trifft der Mensch.
