# Report: Lücken in `owner_mapping` (Stand 07.07.2026)

Grundlage: Supabase-Projekt „Jonas rechnungsworkflow" (`hzeephtezapvgouguigz`), Tabelle `owner_mapping` (47 Eigentümer).

**30 von 47 Eigentümern haben eine `gdrive_folder_id`** (Konzeptdokument ging noch von ~20 aus). Für die folgenden **17 Eigentümer fehlt sie** — deren Rechnungen werden vom Workflow trotzdem erstellt und versendet, landen aber mit Status `completed_no_drive` + Hinweis-Mail, bis der Ordner gepflegt ist:

| Eigentümer | gdrive_folder_id fehlt | easybill_customer_id fehlt | Objekte im object_owner_map |
|---|---|---|---|
| Alexander Klatt | ✗ | – | 2 |
| Andreas Klassen | ✗ | – | 1 |
| **Bege Apartments GmbH** | ✗ | – | **54** |
| **HK & Bege Apartments GmbH** | ✗ | – | **9** |
| Hoster und Ranz Immobilien GbR | ✗ | – | 2 |
| Hotel & Restaurant Eggers GmbH | ✗ | – | 11 |
| Jan und Tim Stratmann | ✗ | – | **0** ⚠️ |
| Jerome Otoo | ✗ | – | 1 |
| Karlheinz Hüchtmann- Kamen | ✗ | – | 1 |
| Martin | ✗ | **✗** | 2 |
| Mikail k | ✗ | **✗** | 2 |
| Morthy Immobilien UG | ✗ | – | 1 |
| Roman Martyn | ✗ | – | 2 |
| Satho Familienstiftung | ✗ | – | 6 |
| Simple Stay GbR | ✗ | – | 3 |
| Til Wiesenberg-Wiesenberg Holding UG | ✗ | – | **0** ⚠️ |
| Tobias Schmidt | ✗ | – | 2 |

## Handlungsbedarf (priorisiert)

1. **Bege Apartments GmbH + HK & Bege Apartments GmbH** (63 Objekte zusammen): Drive-Ordner anlegen/identifizieren und `gdrive_folder_id` eintragen — das sind die volumenstärksten Eigentümer. (Falls Eigenbestand nicht an sich selbst fakturiert werden soll: Objekte ggf. bewusst ohne Weiterberechnung lassen — bitte mit Jonas klären.)
2. **Martin / Mikail k**: zusätzlich `easybill_customer_id` pflegen — ohne sie hält der Workflow jede Rechnung dieser Eigentümer an (HOLD + Mail), es geht nichts verloren.
3. **Jan und Tim Stratmann / Til Wiesenberg** (0 Objekte im Mapping): sobald der Hausmeister für deren Objekte etwas einreicht, greift der HOLD-Pfad („Kein Eigentümer-Mapping"). Objekte in `object_owner_map` ergänzen (object_key = kleingeschriebener, getrimmter Objekt-Name aus dem Formular).

## Pflege

```sql
-- gdrive_folder_id nachtragen (Beispiel):
update owner_mapping set gdrive_folder_id = '<DRIVE_ORDNER_ID>', updated_at = now()
where "Owner_Name" = 'Alexander Klatt';

-- Neues Objekt zuordnen (Beispiel):
insert into object_owner_map (object_key, owner_id, listing_name, source)
values (lower(trim('Musterstraße 1 WE 3')), '<owner_id>', 'Musterstraße 1 WE 3', 'manuell');
```

Ein automatischer Drive-Ordner-Abgleich (Namens-Matching unter „Jonas Managment Rechnungen") wurde bewusst nicht ungeprüft ausgeführt — welches Google-Konto die Ordnerstruktur besitzt, muss zuerst bestätigt werden (siehe README, Go-live-Checkliste Punkt „Drive-Credential").
