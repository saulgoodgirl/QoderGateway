# Operations & Deployment

Operational procedures, database maintenance, and security guidelines for GITIT.

## Deployment Modes

### 1. Cloud Production Deployment (Server A)
- **Host**: Linux Server A (`35.212.220.77:22`), Docker mapped to port `5050`.
- **Public Domain**: `https://lite.bigbob.asia`.
- **Automated Deployer**: Run `python scripts/deploy_remote.py` for hash-based differential upload and hot-reloading.

### 2. Local Environment
- **Host**: Windows 11 with `start.bat` or `uv run qoder2api`.
- Default port: `5050`.

## Database Management

Persistence path:
```text
~/.qoder/qoder2api.db
```

Backup via PowerShell:
```powershell
Copy-Item "$env:USERPROFILE\.qoder\qoder2api.db" "$env:USERPROFILE\Desktop\gitit_db_backup.db"
```

## Cloud Registrar Safety Policy

- The automated registrar is strictly restricted to local deployment.
- On Cloud Server A, `ENABLE_REGISTRAR=false` is enforced. Any incoming request to `/ui/registrar/*` is blocked with `403 Forbidden`.
