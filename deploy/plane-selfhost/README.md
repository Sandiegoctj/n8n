# Plane Self-Hosting — Lokaler Start & Upgrade Community → Commercial

Quelle: `developers.plane.so/self-hosting/upgrade-from-community` (Doc-Quelltext aus
`makeplane/developer-docs`, `docs/self-hosting/upgrade-from-community.md`).
Community-Release gepinnt auf **v1.3.1** (letzter Tag in `makeplane/plane`).

---

## 1. Status: In dieser Umgebung NICHT lauffähig

Der lokale Start wurde vorbereitet und ausgeführt — er scheitert an der
Netzwerk-Policy dieser Session, nicht an der Konfiguration.

| Prüfung | Ergebnis |
| --- | --- |
| Docker Daemon | ✅ läuft (v29.3.1, Compose v5.1.1) |
| Ressourcen | ✅ 4 CPU, 15 GB RAM, 30 GB Disk |
| `docker compose config` | ✅ gültig, 13 Services |
| Release-Assets von GitHub | ✅ `docker-compose.yml`, `variables.env` (HTTP 200) |
| **Image-Pull** | ❌ **blockiert** |
| **Commercial-Installer** | ❌ **blockiert** |

Vom Egress-Proxy abgewiesene Hosts (`connect_rejected`, HTTP 403):

```
prime.plane.so                      → Commercial-Edition-Installer + Config-Download-API
production.cloudfront.docker.com    → Docker-Hub Blob-CDN (alle Image-Layer)
pkg-containers.githubusercontent.com→ ghcr.io Blob-CDN
developers.plane.so / plane.so / docs.plane.so → Dokumentation
```

Konkrete Folgen:

- **Kein einziges Container-Image ist ladbar.** Nicht nur die Plane-Images —
  auch `postgres`, `valkey`, `rabbitmq`, `minio` und selbst `hello-world`
  scheitern. Manifeste werden aufgelöst, aber die Layer liegen auf dem
  blockierten CDN. Nach `./setup.sh start` wurden **0 Container** erzeugt.
- **Lokal bauen statt pullen ist keine Umgehung** — jedes Dockerfile braucht
  Base-Images vom selben blockierten CDN.
- **Die Commercial Edition ist gar nicht installierbar**, da sowohl der
  Installer (`curl https://prime.plane.so/install/ | sh -`) als auch der
  alternative Config-Download (`prime.plane.so/api/v2/setup/`) über den
  gesperrten Host laufen.

> Laut `/root/.ccr/README.md` sind 403/407 vom Proxy Organisations-Policy-Denials,
> die gemeldet und **nicht** umgangen werden. Zum Freischalten müssen die vier
> Hosts oben in der Egress-Policy der Umgebung erlaubt werden.

Auf einer Maschine mit freiem Netzzugang läuft die hier abgelegte Konfiguration
unverändert durch.

---

## 2. Lokaler Start (Community Edition)

Vorbereitet unter `/home/user/plane-selfhost`. Reproduzierbar:

```bash
mkdir -p ~/plane-selfhost && cd ~/plane-selfhost
curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/setup.sh
chmod +x setup.sh
./setup.sh install     # legt plane-app/ mit docker-compose.yaml + plane.env an
```

`setup.sh` akzeptiert die Aktion als Argument (`install`, `start`, `stop`,
`restart`, `upgrade`, `logs`, `backup`) und läuft damit ohne Menü-Interaktion.

### Wichtig: Release pinnen

`./setup.sh install` ermittelt die neueste Version über `api.github.com`. Ist
dieser Host nicht erreichbar (wie hier), bricht das Skript mit
`Failed to check for the latest release` ab und `APP_RELEASE` bleibt leer.
Abhilfe — Version in `plane-app/plane.env` fest eintragen:

```ini
APP_RELEASE=v1.3.1
```

Verfügbare Tags ohne GitHub-API:

```bash
git ls-remote --tags --refs https://github.com/makeplane/plane.git \
  | awk -F'refs/tags/' '{print $2}' \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail
```

### Anpassungen in `plane-app/plane.env`

Gegenüber der ausgelieferten `variables.env` geändert (siehe
`plane.env.example`):

| Variable | Wert | Grund |
| --- | --- | --- |
| `APP_RELEASE` | `v1.3.1` | Version gepinnt, s. o. |
| `LISTEN_HTTP_PORT` | `8080` | Port 80 freihalten |
| `WEB_URL` | `http://localhost:8080` | muss Port enthalten, sonst Login-Redirects kaputt |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | muss exakt `WEB_URL` entsprechen |
| `SECRET_KEY` | neu generiert | Auslieferung enthält einen festen Default |
| `LIVE_SERVER_SECRET_KEY` | neu generiert | war leer |

Secrets erzeugen:

```bash
tr -dc 'a-z0-9' < /dev/urandom | head -c50
```

`plane.env.example` in diesem Ordner ist **ohne** Secrets — vor Gebrauch beide
Werte setzen.

### Starten

```bash
cd ~/plane-selfhost
./setup.sh start
```

Danach erreichbar unter `http://localhost:8080`.

Weitere Aktionen: `./setup.sh stop`, `./setup.sh restart`, `./setup.sh logs`.
`plane.env` immer im gestoppten Zustand ändern.

---

## 3. Upgrade Community → Commercial

Der Upgrade-Pfad ist **kein In-Place-Update**. Es wird eine zweite Maschine mit
der Commercial Edition aufgesetzt und die Daten der Community-Instanz dorthin
migriert.

### Voraussetzungen

- Commercial Edition auf einer **frischen Maschine** installieren — nicht auf der
  Maschine, auf der die Community Edition läuft.
- Als `root` bzw. mit `sudo` arbeiten (`/opt` benötigt erhöhte Rechte).
- Gilt für Docker-Installationen. Bei Kubernetes: DB-Dump und Datei-Storage
  manuell sichern (Volumes/Storage-Pfade kopieren).

### Schritt 0 — Commercial Edition installieren (Zielmaschine)

```bash
curl -fsSL https://prime.plane.so/install/ | sh -
```

Domain im Format `domain.tld` bzw. `subdomain.domain.tld` angeben, dann
**Express** (Defaults) oder **Advanced** (eigene DB/Redis/Storage) wählen.

> Für Produktion externe DB und externen Object Storage konfigurieren. Rein
> lokale Volumes bedeuten Datenverlust beim Ausfall der Maschine.

### Variante A — Standard-Setup (eingebaute DB & MinIO)

**Backup auf der Community-Instanz**

```bash
curl -fsSL https://github.com/makeplane/plane/releases/latest/download/setup.sh -o setup.sh
./setup.sh backup
```

Das Backup landet in einem Ordner, der am Ende ausgegeben wird
(z. B. `/plane-selfhost/plane-app/backup/20240522-1027`) und enthält drei Dateien:

- `pgdata.tar.gz`
- `redisdata.tar.gz`
- `uploads.tar.gz`

Alle drei auf die Commercial-Maschine kopieren, z. B. nach `~/ce-backup`.

**Restore auf der Commercial-Instanz**

```bash
cd ~/ce-backup
```

```bash
TARGET_DIR=/opt/plane/data
sudo mkdir -p $TARGET_DIR

for FILE in *.tar.gz; do
    if [ -e "$FILE" ]; then
        tar -xzvf "$FILE" -C "$TARGET_DIR"
    else
        echo "No .tar.gz files found in the current directory."
        exit 1
    fi
done

# Ziele erst entfernen, dann verschieben
sudo rm -rf $TARGET_DIR/db && mv $TARGET_DIR/pgdata $TARGET_DIR/db
sudo rm -rf $TARGET_DIR/redis && mv $TARGET_DIR/redisdata $TARGET_DIR/redis

mkdir -p $TARGET_DIR/minio
sudo rm -rf $TARGET_DIR/minio/uploads && mv $TARGET_DIR/uploads $TARGET_DIR/minio/uploads
```

Die Daten liegen anschließend unter `/opt/plane/data`.

> `rm -rf` trifft hier bestehende Daten der Commercial-Instanz. Nur auf einer
> frischen Zielinstanz ausführen — sonst vorher den Abschnitt „Rollback" lesen
> und Sicherungskopien anlegen.

### Variante B — Managed Services (externe DB & Storage)

Liegen die Daten bereits in externen Diensten (z. B. RDS + S3), entfällt
Backup/Restore. Nur die Konfiguration in `/opt/plane/plane.env` anpassen:

```ini
DATABASE_URL=postgresql://user:password@your-db-host:5432/plane
```

```ini
USE_MINIO=0
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>
AWS_S3_ENDPOINT_URL=https://s3.amazonaws.com
AWS_S3_BUCKET_NAME=plane-uploads
```

`USE_MINIO=0` deaktiviert den lokalen MinIO-Dienst und aktiviert externen
S3-kompatiblen Storage. Danach:

```bash
prime-cli restart
```

### Variante C — Manuell ohne CLI

Wenn `setup.sh` in der Umgebung nicht funktioniert. Migriert werden die
PostgreSQL-Datenbank und die MinIO-Uploads. Voraussetzung: kompatible Versionen
von CE und Commercial, Shell-Zugriff und Docker auf beiden Servern.

**Backup (Community)**

```bash
mkdir -p ~/ce-backups/db
mkdir -p ~/ce-backups/minio/uploads
cd ~/ce-backups

docker cp plane-app-plane-db-1:/var/lib/postgresql/data/. db/
docker cp plane-app-plane-minio-1:/export/uploads minio/uploads/

du -sh db minio/uploads          # Größen plausibel? Nicht nur ein paar KB?

scp -r ~/ce-backups user@commercial-server:/tmp/
```

**Restore (Commercial)**

```bash
prime-cli stop
docker ps                        # alle Container gestoppt?

# Bestehende Daten sichern
mv /opt/plane/data/db /opt/plane/data/db.bak
mv /opt/plane/data/minio/uploads /opt/plane/data/minio/uploads.bak

mv /tmp/ce-backups/db /opt/plane/data/db
mv /tmp/ce-backups/minio/uploads /opt/plane/data/minio/uploads

prime-cli restart
```

**Rollback**

```bash
prime-cli stop

rm -rf /opt/plane/data/db
mv /opt/plane/data/db.bak /opt/plane/data/db

rm -rf /opt/plane/data/minio/uploads
mv /opt/plane/data/minio/uploads.bak /opt/plane/data/minio/uploads

prime-cli restart
```

### Validierung nach der Migration

- Login funktioniert
- Projekte sind sichtbar
- Anhänge lassen sich öffnen

### Danach

Bei gekauftem Plan den Lizenzschlüssel aktivieren:
`developers.plane.so/self-hosting/manage/manage-licenses/activate-pro-and-business`.
Die Commercial Edition läuft auch ohne Lizenz im Free-Plan.

---

## 4. Dateien in diesem Ordner

| Datei | Inhalt |
| --- | --- |
| `docker-compose.yaml` | Community Edition v1.3.1, unverändert aus dem GitHub-Release |
| `plane.env.example` | Konfiguration für lokalen Start, **Secrets geleert** |
| `README.md` | dieses Dokument |

`setup.sh` ist bewusst nicht eingecheckt — immer frisch vom Release ziehen.

---

## 5. Offen / durch Menschen zu prüfen

Nicht verifizierbar in dieser Umgebung, da kein Container startbar war:

- Lauffähigkeit des Stacks, Migrator-Durchlauf, Erreichbarkeit von `:8080`
- Der komplette Upgrade-Pfad (Backup, Restore, Login, Anhänge) — die Schritte
  oben sind aus der offiziellen Doku übernommen, aber hier **nicht ausgeführt**
- Verhalten des Commercial-Installers und `prime-cli`
- Versions-Kompatibilität zwischen der eingesetzten CE-Version und der
  Commercial-Zielversion
