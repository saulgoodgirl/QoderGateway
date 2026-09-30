import base64
import hashlib
import secrets
import urllib.parse
import uuid
from typing import Any

import httpx
from fastapi import HTTPException

from .database import get_db
from .accounts import db_get_settings, db_set_settings


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("utf-8").rstrip("=")


def generate_pkce_pair() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def initiate_qoder_device_flow(region: str = "cn") -> dict[str, Any]:
    """Initiates an RFC 8628 OAuth Device Authorization flow for Qoder CN or International."""
    verifier, challenge = generate_pkce_pair()
    nonce = str(uuid.uuid4())
    machine_id = str(uuid.uuid4())
    login_base = (
        "https://qoder.com.cn/device/selectAccounts"
        if region == "cn"
        else "https://qoder.com/device/selectAccounts"
    )
    query_params = {
        "challenge": challenge,
        "challenge_method": "S256",
        "machine_id": machine_id,
        "nonce": nonce,
    }
    verification_uri_complete = f"{login_base}?{urllib.parse.urlencode(query_params)}"
    user_code = nonce[:8].upper()

    return {
        "verification_uri": login_base,
        "verification_uri_complete": verification_uri_complete,
        "user_code": user_code,
        "device_code": nonce,
        "code_verifier": verifier,
        "machine_id": machine_id,
        "expires_in": 300,
        "interval": 2,
    }


async def poll_qoder_device_token(
    nonce: str,
    verifier: str,
    machine_id: str,
    region: str = "cn",
) -> dict[str, Any]:
    """Polls the Qoder device token endpoint and saves authorized session to database."""
    poll_url = (
        "https://openapi.qoder.com.cn/api/v1/deviceToken/poll"
        if region == "cn"
        else "https://openapi.qoder.sh/api/v1/deviceToken/poll"
    )
    params = {
        "nonce": nonce,
        "verifier": verifier,
        "challenge_method": "S256",
    }
    headers = {
        "Accept": "application/json",
        "User-Agent": "Go-http-client/2.0",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(poll_url, params=params, headers=headers)
        except Exception as exc:
            return {"status": "pending", "detail": str(exc)}

        if resp.status_code in (202, 404):
            return {"status": "pending"}

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Qoder device token poll failed: HTTP {resp.status_code} {resp.text}",
            )

        try:
            data = resp.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Invalid JSON from Qoder poll: {exc}")

        token = data.get("token") or data.get("access_token")
        if not token:
            return {"status": "pending"}

        refresh_token = data.get("refresh_token", "")
        user_id = data.get("user_id", "")

        # Fetch user profile info
        user_info_url = (
            "https://openapi.qoder.com.cn/api/v1/userinfo"
            if region == "cn"
            else "https://openapi.qoder.sh/api/v1/userinfo"
        )
        user_info: dict[str, Any] = {}
        try:
            u_resp = await client.get(
                user_info_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "User-Agent": "Go-http-client/2.0",
                },
            )
            if u_resp.status_code == 200:
                user_info = u_resp.json()
        except Exception:
            pass

        account_name = (
            user_info.get("name")
            or user_info.get("username")
            or user_info.get("nickname")
            or f"Qoder_{nonce[:8].upper()}"
        ).strip()
        uid = str(user_id or user_info.get("id") or user_info.get("uid") or f"qoder_{uuid.uuid4().hex[:12]}")
        user_type = "enterprise" if user_info.get("organization_id") else "personal"

        # Save or update into database
        with get_db() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO accounts (
                    uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                    enabled, last_status, last_error, region, provider, plan, user_tag
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 'ok', NULL, ?, 'qoder', ?, ?)
                """,
                (
                    uid,
                    account_name,
                    user_type,
                    token,
                    refresh_token,
                    machine_id,
                    region,
                    f"Qoder {user_type.capitalize()}",
                    "OAUTH",
                ),
            )
            if not db_get_settings("active_uid"):
                db_set_settings("active_uid", uid)

        return {
            "status": "ok",
            "account": {
                "uid": uid,
                "name": account_name,
                "user_type": user_type,
                "provider": "qoder",
            },
        }
