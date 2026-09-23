import os
import sys
import time
import json
import hashlib
import argparse
import paramiko
from pathlib import Path

REMOTE_HOST = '35.212.220.77'
REMOTE_PORT = 22
REMOTE_USER = 'root'
REMOTE_PASS = '826525931'
REMOTE_DIR = '/root/qodergateway'

LOCAL_ROOT = Path(__file__).resolve().parent.parent
LOCAL_SRC = LOCAL_ROOT / 'src' / 'qoder2api'
CACHE_FILE = LOCAL_ROOT / '.deploy_cache.json'

def compute_md5(file_path: Path) -> str:
    h = hashlib.md5()
    with open(file_path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def get_local_hashes() -> dict[str, str]:
    hashes = {}
    for item in LOCAL_SRC.rglob('*'):
        if item.is_file():
            if item.name.startswith('.') or '__pycache__' in item.parts:
                continue
            rel_path = item.relative_to(LOCAL_SRC).as_posix()
            hashes[rel_path] = compute_md5(item)
    return hashes

def load_cache() -> dict[str, str]:
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache: dict[str, str]):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2)

def main():
    parser = argparse.ArgumentParser(description="Lightning Fast Deployer for QoderGateway")
    parser.add_argument("--full", action="store_true", help="Force full Docker Compose rebuild instead of fast container restart")
    parser.add_argument("--all", action="store_true", help="Force upload all files regardless of cache")
    args = parser.parse_args()

    start_time = time.time()
    print("=" * 60, flush=True)
    print(">> QODERGATEWAY Lightning Fast Deployer (Hash Cache + Fast Restart)", flush=True)
    print("=" * 60, flush=True)

    current_hashes = get_local_hashes()
    cached_hashes = {} if args.all else load_cache()

    changed_files: list[str] = []
    for rel_path, current_hash in current_hashes.items():
        if rel_path not in cached_hashes or cached_hashes[rel_path] != current_hash:
            changed_files.append(rel_path)

    print(f"Total files: {len(current_hashes)} | Changed: {len(changed_files)} | Unchanged: {len(current_hashes) - len(changed_files)}", flush=True)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(REMOTE_HOST, port=REMOTE_PORT, username=REMOTE_USER, password=REMOTE_PASS, timeout=15)

    if changed_files:
        sftp = ssh.open_sftp()
        for rel_path in changed_files:
            local_path = LOCAL_SRC / rel_path
            remote_path = f"{REMOTE_DIR}/src/qoder2api/{rel_path}"
            remote_parent = os.path.dirname(remote_path)
            
            # Ensure remote directory exists
            try:
                ssh.exec_command(f"mkdir -p '{remote_parent}'")
            except Exception:
                pass

            print(f"  -> Uploading: {rel_path} ({local_path.stat().st_size} bytes)", flush=True)
            sftp.put(str(local_path), remote_path)
            cached_hashes[rel_path] = current_hashes[rel_path]

        sftp.close()
        save_cache(cached_hashes)
        print(f"[OK] Uploaded {len(changed_files)} changed files.", flush=True)
    else:
        print("[INFO] All files are up-to-date with remote. No upload needed.", flush=True)

    if args.full:
        print("[BUILD] Full rebuild mode: running docker compose build && docker compose up -d...", flush=True)
        stdin, stdout, stderr = ssh.exec_command(f"cd {REMOTE_DIR} && docker compose build && docker compose up -d")
        out = stdout.read().decode('utf-8', errors='replace')
        print(out, flush=True)
    else:
        # Check if Python files changed
        has_py_changed = any(f.endswith('.py') for f in changed_files)
        if has_py_changed or args.all or not changed_files:
            print("[FAST] Python code changed: restarting container (0.8s)...", flush=True)
            stdin, stdout, stderr = ssh.exec_command("docker restart qodergateway")
            out = stdout.read().decode('utf-8', errors='replace')
            print(f"Container restart: {out.strip()}", flush=True)
        else:
            print("[HOT] Only static/asset files changed. Live mount in effect, no container restart needed!", flush=True)

    print("Checking container health...", flush=True)
    stdin, stdout, stderr = ssh.exec_command("docker ps --filter name=qodergateway --format 'Status: {{.Status}} | Ports: {{.Ports}}'")
    print(stdout.read().decode('utf-8', errors='replace').strip(), flush=True)

    ssh.close()
    elapsed = time.time() - start_time
    print(f"[DONE] Deployment completed in {elapsed:.2f} seconds!", flush=True)
    print("=" * 60, flush=True)

if __name__ == '__main__':
    main()
