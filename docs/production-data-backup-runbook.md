# Production file storage backup runbook

This runbook copies the Railway production volume mounted at `/data` to a
local folder before any production dry-run, database migration, or storage
adapter switch.

Rules:

- Do not deploy.
- Do not change Railway environment variables.
- Do not create or use a production PostgreSQL database.
- Do not run `--apply` against production.
- Do not write to, delete, reset, or move `/data`.
- Do not save the backup inside this repo.
- Do not commit backup files, `.env`, tokens, `customers.csv`,
  `chat-state.json`, `events.jsonl`, or `processed-mids.json`.

## Preconditions

- Railway CLI is installed and authenticated.
- The CLI is linked to the correct project, or every command includes
  `--project <PROJECT_ID>`.
- Service is `chatbot-fanpage`.
- Environment is `production`.
- Runtime still uses file storage and `DATA_DIR=/data`.
- Page ID is `1026325343908119`.

Check Railway access without reading data:

```powershell
railway whoami
railway status
railway ssh --service chatbot-fanpage --environment production -- sh -lc 'printf RAILWAY_SSH_OK'
```

## Option A: single archive copy via Railway SSH

This is the preferred Windows-safe path. It streams a gzip tar archive as
base64 text, then decodes it locally.

Create a local backup directory outside the repo:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Users\Pc\Desktop\chatbot-fanpage-backups\$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
```

Read-only inspect the production volume:

```powershell
railway ssh --service chatbot-fanpage --environment production -- sh -lc 'set -eu; test -d /data; pwd; ls -la /data; du -sh /data || true'
```

Copy the expected storage files from `/data` into a local archive:

```powershell
railway ssh --service chatbot-fanpage --environment production -- sh -lc 'set -eu; cd /data; files=""; for f in chat-state.json customers.csv events.jsonl processed-mids.json sheet-outbox.jsonl; do [ -e "$f" ] && files="$files $f"; done; [ -n "$files" ] || { echo "No expected storage files found in /data" >&2; exit 1; }; tar -czf - $files | base64' > "$backupRoot\data.tar.gz.b64"
certutil -f -decode "$backupRoot\data.tar.gz.b64" "$backupRoot\data.tar.gz"
```

Verify the archive and extract it into a local copy:

```powershell
tar -tzf "$backupRoot\data.tar.gz"
New-Item -ItemType Directory -Path "$backupRoot\data" -Force | Out-Null
tar -xzf "$backupRoot\data.tar.gz" -C "$backupRoot\data"
Get-ChildItem -Force "$backupRoot\data"
Get-FileHash "$backupRoot\data.tar.gz" -Algorithm SHA256 | Tee-Object -FilePath "$backupRoot\data.tar.gz.sha256.txt"
```

Run a dry-run only against the local copy:

```powershell
node scripts/migrate-file-storage-to-postgres.js --dry-run --data-dir "$backupRoot\data" --tenant-id default --page-id 1026325343908119 --json > "$backupRoot\migration-dry-run.json"
Get-Content "$backupRoot\migration-dry-run.json"
```

## Option B: copy files one by one

Use this if the archive stream fails. This reads each production file and
decodes it locally.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Users\Pc\Desktop\chatbot-fanpage-backups\$stamp"
$dataCopy = Join-Path $backupRoot "data"
New-Item -ItemType Directory -Path $dataCopy -Force | Out-Null

$files = @(
  "chat-state.json",
  "customers.csv",
  "events.jsonl",
  "processed-mids.json",
  "sheet-outbox.jsonl"
)

foreach ($file in $files) {
  $remote = "/data/$file"
  $b64 = Join-Path $backupRoot "$file.b64"
  $out = Join-Path $dataCopy $file
  railway ssh --service chatbot-fanpage --environment production -- sh -lc "test -f '$remote' && base64 '$remote' || true" > $b64
  if ((Get-Item $b64).Length -gt 0) {
    certutil -f -decode $b64 $out | Out-Null
  }
}

Get-ChildItem -Force $dataCopy
Get-FileHash (Join-Path $dataCopy "*") -Algorithm SHA256 | Tee-Object -FilePath (Join-Path $backupRoot "files.sha256.txt")
```

Then run dry-run only against the local copy:

```powershell
node scripts/migrate-file-storage-to-postgres.js --dry-run --data-dir "$dataCopy" --tenant-id default --page-id 1026325343908119 --json > "$backupRoot\migration-dry-run.json"
Get-Content "$backupRoot\migration-dry-run.json"
```

## Acceptance checklist

- Backup folder is outside the repo.
- Archive or copied files open locally.
- Hash file exists.
- Local copy contains the expected storage files.
- Dry-run report was generated from the local copy.
- No Railway deploy happened.
- No Railway env changed.
- No production DB was created or written.
- `/data` was only read.

Production database writes remain blocked until:

- schema is reviewed;
- production `/data` has a verified copy outside Railway;
- production dry-run report from the local copy is reviewed;
- dev/staging DB apply has passed;
- the owner explicitly says: `duoc ghi DB production`.
