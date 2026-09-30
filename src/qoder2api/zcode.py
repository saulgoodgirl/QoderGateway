import base64
import getpass
import hashlib
import json
import os
import sys
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BIGMODEL_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZCODE_CONFIG_DIR = Path.home() / ".zcode" / "v2"
CREDENTIALS_FILE = ZCODE_CONFIG_DIR / "credentials.json"
CONFIG_FILE = ZCODE_CONFIG_DIR / "config.json"


def b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def get_fallback_key() -> bytes:
    platform_name = "win32" if sys.platform == "win32" else sys.platform
    username = getpass.getuser()
    homedir = str(Path.home())
    fallback = f"zcode-credential-fallback:{platform_name}:{homedir}:{username}"
    return hashlib.sha256(fallback.encode("utf-8")).digest()


def decrypt_zcode_value(encrypted_val: str, key: bytes | None = None) -> str:
    if not isinstance(encrypted_val, str) or not encrypted_val.startswith("enc:v1:"):
        return str(encrypted_val)
    if key is None:
        key = get_fallback_key()
    parts = encrypted_val[len("enc:v1:") :].split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid encrypted payload structure: {len(parts)} parts")
    iv = b64url_decode(parts[0])
    tag = b64url_decode(parts[1])
    ct = b64url_decode(parts[2])
    aesgcm = AESGCM(key)
    # In cryptography's AESGCM, ciphertext and tag are concatenated
    pt = aesgcm.decrypt(iv, ct + tag, None)
    return pt.decode("utf-8")


def load_local_zcode_credentials() -> dict[str, Any]:
    """Reads and decrypts local ZCode credentials from ~/.zcode/v2/credentials.json.

    Returns dict containing uid, name, token, jwt, user_info, provider='zcode'.
    """
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError(f"Local ZCode credentials not found at {CREDENTIALS_FILE}")

    with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
        raw_creds = json.load(f)

    key = get_fallback_key()
    decrypted: dict[str, Any] = {}
    for k, v in raw_creds.items():
        if isinstance(v, str) and v.startswith("enc:v1:"):
            try:
                decrypted[k] = decrypt_zcode_value(v, key)
            except Exception as e:
                decrypted[k] = f"[decrypt_error: {e}]"
        else:
            decrypted[k] = v

    token = decrypted.get("oauth:bigmodel:access_token", "")
    jwt = decrypted.get("zcodejwttoken", "")
    user_info_str = decrypted.get("oauth:bigmodel:user_info", "{}")
    user_info = {}
    try:
        user_info = json.loads(user_info_str) if isinstance(user_info_str, str) else user_info_str
    except Exception:
        pass

    # Check config.json for direct BigModel / ZCode API Key
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            providers = cfg.get("provider", {})
            for p_key in ("builtin:bigmodel", "builtin:bigmodel-coding-plan", "builtin:bigmodel-start-plan"):
                sub_opts = providers.get(p_key, {}).get("options", {})
                cand_key = sub_opts.get("apiKey", "").strip()
                if cand_key and "." in cand_key:
                    token = cand_key
                    break
        except Exception:
            pass

    uid = str(user_info.get("id") or user_info.get("uid") or "").strip()
    name = str(user_info.get("name") or user_info.get("username") or user_info.get("nickname") or "ZCode User").strip()

    if not uid and token:
        # Fallback UID from token hash
        uid = "zcode_" + hashlib.md5(token.encode("utf-8")).hexdigest()[:16]

    return {
        "provider": "zcode",
        "uid": uid,
        "name": name,
        "token": token,
        "jwt": jwt,
        "user_info": user_info,
        "region": "cn",
    }


def clean_zcode_model(raw_model: str) -> str:
    """Normalizes model name for ZCode / BigModel API."""
    m = raw_model.strip()
    if m.startswith("zcode/"):
        m = m[6:]
    elif m.startswith("zcode-"):
        m = m[6:]
    if "@" in m:
        m = m.split("@")[0].strip()
    # If generic or empty, default to glm-4-flash
    if not m or m in ("default", "lite", "auto"):
        return "glm-4-flash"
    return m


async def forward_zcode_stream(
    payload: dict[str, Any],
    api_key: str,
    base_url: str | None = None,
) -> AsyncIterator[str]:
    """Streams chat completions directly from ZCode / BigModel upstream in OpenAI SSE format."""
    target_url = base_url.strip() if base_url and base_url.strip() else BIGMODEL_API_URL
    upstream_payload = dict(payload)
    upstream_payload["model"] = clean_zcode_model(payload.get("model", "glm-4-flash"))
    upstream_payload["stream"] = True

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", target_url, headers=headers, json=upstream_payload) as resp:
            if resp.status_code >= 400:
                error_body = await resp.aread()
                err_text = error_body.decode(errors="ignore")
                err_data = {"error": {"message": f"ZCode upstream error {resp.status_code}: {err_text}"}}
                yield f"data: {json.dumps(err_data)}\n\n"
                yield "data: [DONE]\n\n"
                return

            async for line in resp.aiter_lines():
                if not line:
                    continue
                yield f"{line}\n\n"


async def forward_zcode_complete(
    payload: dict[str, Any],
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Executes a full non-streaming completion request against ZCode / BigModel upstream."""
    target_url = base_url.strip() if base_url and base_url.strip() else BIGMODEL_API_URL
    upstream_payload = dict(payload)
    upstream_payload["model"] = clean_zcode_model(payload.get("model", "glm-4-flash"))
    upstream_payload["stream"] = False

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(target_url, headers=headers, json=upstream_payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"ZCode upstream error {resp.status_code}: {resp.text}")
        return resp.json()


async def ping_zcode_account(api_key: str, base_url: str | None = None) -> dict[str, Any]:
    """Lightweight health check and token validity ping for a ZCode account."""
    target_url = base_url.strip() if base_url and base_url.strip() else BIGMODEL_API_URL
    test_payload = {
        "model": "glm-4-flash",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(target_url, headers=headers, json=test_payload)
            latency_ms = int((time.time() - t0) * 1000)
            if resp.status_code == 200:
                return {"ok": True, "latency_ms": latency_ms, "status": "active"}
            return {"ok": False, "status_code": resp.status_code, "error": resp.text[:120]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
