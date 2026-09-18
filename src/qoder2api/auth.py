import base64
import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any
from pathlib import Path
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import padding, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asymmetric_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from . import encoding
from .env import httpx_client_kwargs
from .signature import APPCODE, current_date, sign


SERVER_PUBKEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----"""


@dataclass(frozen=True)
class AuthIdentity:
    name: str
    aid: str
    uid: str
    yx_uid: str
    organization_id: str
    organization_name: str
    user_type: str
    security_oauth_token: str
    refresh_token: str
    region: str = "cn"


@dataclass(frozen=True)
class SessionContext:
    temp_key: bytes
    cosy_key: str
    info: str
    identity: AuthIdentity
    machine_id: str
    machine_token: str
    machine_type: str
    region: str = "cn"


def new_machine() -> tuple[str, str, str]:
    machine_id = str(uuid.uuid4())
    seed = (str(uuid.uuid4()) + str(uuid.uuid4()))[:50].encode()
    machine_token = base64.urlsafe_b64encode(seed).decode().rstrip("=")
    machine_type = uuid.uuid4().hex[:18]
    return machine_id, machine_token, machine_type


def aes_cbc_pkcs7_encrypt(plain: bytes, key: bytes) -> bytes:
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plain) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(key)).encryptor()
    return encryptor.update(padded) + encryptor.finalize()


def rsa_encrypt(plain: bytes) -> bytes:
    public_key = serialization.load_pem_public_key(SERVER_PUBKEY_PEM)
    return public_key.encrypt(plain, asymmetric_padding.PKCS1v15())


def auth_payload(identity: AuthIdentity) -> bytes:
    return json.dumps(
        {
            "name": identity.name,
            "aid": identity.aid,
            "uid": identity.uid,
            "yx_uid": identity.yx_uid,
            "organization_id": identity.organization_id,
            "organization_name": identity.organization_name,
            "user_type": identity.user_type,
            "security_oauth_token": identity.security_oauth_token,
            "refresh_token": identity.refresh_token,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()


def new_session(identity: AuthIdentity, machine_id: str, machine_token: str, machine_type: str) -> SessionContext:
    temp_key = uuid.uuid4().hex[:16].encode("ascii")
    cosy_key = base64.b64encode(rsa_encrypt(temp_key)).decode()
    info = base64.b64encode(aes_cbc_pkcs7_encrypt(auth_payload(identity), temp_key)).decode()
    return SessionContext(temp_key, cosy_key, info, identity, machine_id, machine_token, machine_type, identity.region)


def build_payload_b64(info: str) -> str:
    payload = {
        "cosyVersion": "0.1.43",
        "ideVersion": "",
        "info": info,
        "requestId": str(uuid.uuid4()),
        "version": "v1",
    }
    raw = json.dumps(dict(sorted(payload.items())), separators=(",", ":")).encode()
    return base64.b64encode(raw).decode()


def sign_request(payload_b64: str, cosy_key: str, cosy_date: str, body: str, path_without_algo: str) -> str:
    raw = f"{payload_b64}\n{cosy_key}\n{cosy_date}\n{body}\n{path_without_algo}"
    return hashlib.md5(raw.encode()).hexdigest()


def bearer_headers(sess: SessionContext, full_url: str, body: str, accept: str, extra_headers: dict[str, str] | None = None) -> dict[str, str]:
    path = urlparse(full_url).path
    path_sig = path[len("/algo") :] if path.startswith("/algo") else path
    payload_b64 = build_payload_b64(sess.info)
    date = str(int(time.time()))
    sig = sign_request(payload_b64, sess.cosy_key, date, body, path_sig)
    headers = {
        "cosy-data-policy": "AGREE",
        "content-type": "application/json",
        "cosy-machinetype": sess.machine_type,
        "cosy-clienttype": "5",
        "cosy-date": date,
        "cosy-user": sess.identity.uid,
        "cosy-key": sess.cosy_key,
        "accept": accept,
        "cosy-clientip": "169.254.198.161",
        "authorization": f"Bearer COSY.{payload_b64}.{sig}",
        "accept-encoding": "identity",
        "cosy-version": "0.1.43",
        "cosy-machineid": sess.machine_id,
        "cosy-machinetoken": sess.machine_token,
        "login-version": "v2",
        "user-agent": "Go-http-client/2.0",
    }
    if accept == "text/event-stream":
        headers["cache-control"] = "no-cache"
    if extra_headers:
        headers.update(extra_headers)
    return headers


async def exchange_job_token(personal_token: str, machine_id: str, machine_token: str, machine_type: str) -> dict[str, Any]:
    inner = {
        "personalToken": personal_token,
        "securityOauthToken": "",
        "refreshToken": "",
        "needRefresh": False,
        "authInfo": {},
    }
    outer = {"payload": json.dumps(inner, ensure_ascii=False, separators=(",", ":")), "encodeVersion": "1"}
    body = encoding.encode(json.dumps(outer, ensure_ascii=False, separators=(",", ":")).encode())
    date = current_date()
    headers = {
        "cosy-machinetoken": machine_token,
        "cosy-machinetype": machine_type,
        "login-version": "v2",
        "appcode": APPCODE,
        "accept": "application/json",
        "accept-encoding": "identity",
        "cosy-version": "0.1.43",
        "cosy-clienttype": "5",
        "date": date,
        "signature": sign(date),
        "content-type": "application/json",
        "cosy-machineid": machine_id,
        "user-agent": "Go-http-client/2.0",
    }
    async with httpx.AsyncClient(timeout=15, **httpx_client_kwargs()) as client:
        response = await client.post("https://center.qoder.sh/algo/api/v3/user/jobToken?Encode=1", content=body, headers=headers)
    if response.status_code != 200:
        raise RuntimeError(f"jobToken HTTP {response.status_code} body={response.text}")
    return response.json()


async def exchange_job_token_cn(personal_token: str) -> tuple[str, str, dict[str, Any]]:
    """Exchange PAT for domestic Qoder CN."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "pi-provider-qoder",
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }
    async with httpx.AsyncClient(timeout=15, **httpx_client_kwargs()) as client:
        resp = await client.post(
            "https://openapi.qoder.com.cn/api/v1/jobToken/exchange",
            json={"personal_token": personal_token},
            headers=headers,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"CN exchange HTTP {resp.status_code}: {resp.text}")
        body = resp.json()
        token = body.get("token") or ""
        refresh_token = body.get("refresh_token") or ""
        if not token:
            raise RuntimeError("CN exchange returned empty token")

        user_data = {}
        try:
            u_resp = await client.get(
                "https://openapi.qoder.com.cn/api/v1/userinfo",
                headers={"Authorization": f"Bearer {token}", **headers},
            )
            if u_resp.status_code == 200:
                user_data = u_resp.json()
        except Exception:
            pass
        return token, refresh_token, user_data


async def exchange_job_token_global(personal_token: str) -> tuple[str, str, dict[str, Any]]:
    """Exchange PAT for global Qoder openapi."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "pi-provider-qoder",
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }
    async with httpx.AsyncClient(timeout=15, **httpx_client_kwargs()) as client:
        resp = await client.post(
            "https://openapi.qoder.sh/api/v1/jobToken/exchange",
            json={"personal_token": personal_token},
            headers=headers,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Global exchange HTTP {resp.status_code}: {resp.text}")
        body = resp.json()
        token = body.get("token") or ""
        refresh_token = body.get("refresh_token") or ""
        user_data = {}
        try:
            u_resp = await client.get(
                "https://openapi.qoder.sh/api/v1/userinfo",
                headers={"Authorization": f"Bearer {token}", **headers},
            )
            if u_resp.status_code == 200:
                user_data = u_resp.json()
        except Exception:
            pass
        return token, refresh_token, user_data


async def create_session(personal_token: str) -> SessionContext:
    machine_id, machine_token, machine_type = new_machine()

    # 1. 优先尝试国内版 Qoder CN (openapi.qoder.com.cn)
    try:
        token, refresh_token, user_data = await exchange_job_token_cn(personal_token)
        uid = str(user_data.get("id") or user_data.get("userId") or user_data.get("user_id") or ("cn_" + personal_token[-12:]))
        name = str(user_data.get("name") or user_data.get("nickname") or user_data.get("email") or "Qoder CN")
        identity = AuthIdentity(
            name=name,
            aid=uid,
            uid=uid,
            yx_uid="",
            organization_id="",
            organization_name="",
            user_type="personal_standard",
            security_oauth_token=token,
            refresh_token=refresh_token,
            region="cn",
        )
        return new_session(identity, machine_id, machine_token, machine_type)
    except Exception as e_cn:
        # 2. 尝试国际版 openapi (openapi.qoder.sh)
        try:
            token, refresh_token, user_data = await exchange_job_token_global(personal_token)
            uid = str(user_data.get("id") or user_data.get("userId") or user_data.get("user_id") or ("gl_" + personal_token[-12:]))
            name = str(user_data.get("name") or "Qoder Global")
            identity = AuthIdentity(
                name=name,
                aid=uid,
                uid=uid,
                yx_uid="",
                organization_id="",
                organization_name="",
                user_type="personal_standard",
                security_oauth_token=token,
                refresh_token=refresh_token,
                region="global",
            )
            return new_session(identity, machine_id, machine_token, machine_type)
        except Exception:
            pass

        # 3. 兜底尝试老版 center.qoder.sh
        try:
            data = await exchange_job_token(personal_token, machine_id, machine_token, machine_type)
            identity = AuthIdentity(
                name=data.get("name", ""),
                aid=data.get("id", ""),
                uid=data.get("id", ""),
                yx_uid="",
                organization_id="",
                organization_name="",
                user_type=data.get("userType", "personal_standard"),
                security_oauth_token=data.get("securityOauthToken", ""),
                refresh_token=data.get("refreshToken", ""),
                region="global",
            )
            return new_session(identity, machine_id, machine_token, machine_type)
        except Exception as e_legacy:
            raise RuntimeError(f"Qoder CN 验证失败: {e_cn} | 国际版验证失败: {e_legacy}")


def load_local_session() -> SessionContext:
    auth_dir = Path.home() / ".qoder" / ".auth"
    id_path = auth_dir / "id"
    if not id_path.exists():
        id_path = auth_dir / "machine_id"
    user_path = auth_dir / "user"
    if not id_path.exists() or not user_path.exists():
        raise FileNotFoundError("Local Qoder auth files (id/machine_id and user) not found.")
    
    machine_id = id_path.read_text(encoding="utf-8").strip()
    cipher_bytes = base64.b64decode(user_path.read_text(encoding="utf-8").strip())
    
    key = machine_id[:16].encode("ascii")
    
    cipher = Cipher(algorithms.AES(key), modes.CBC(key))
    decryptor = cipher.decryptor()
    padded_plain = decryptor.update(cipher_bytes) + decryptor.finalize()
    
    unpadder = padding.PKCS7(128).unpadder()
    plain = unpadder.update(padded_plain) + unpadder.finalize()
    
    data = json.loads(plain.decode("utf-8"))
    
    identity = AuthIdentity(
        name=data.get("name", ""),
        aid=data.get("id") or data.get("aid") or data.get("uid") or "",
        uid=data.get("id") or data.get("uid") or data.get("aid") or "",
        yx_uid=data.get("yx_uid") or data.get("yxUid") or "",
        organization_id=data.get("organization_id") or data.get("organizationId") or "",
        organization_name=data.get("organization_name") or data.get("organizationName") or "",
        user_type=data.get("userType") or data.get("user_type") or "personal_standard",
        security_oauth_token=data.get("securityOauthToken") or data.get("security_oauth_token") or "",
        refresh_token=data.get("refreshToken") or data.get("refresh_token") or "",
    )
    
    _, machine_token, machine_type = new_machine()
    return new_session(identity, machine_id, machine_token, machine_type)


async def fetch_user_status(user_id: str, machine_id: str, machine_token: str, machine_type: str) -> dict[str, Any]:
    inner = {
        "userId": user_id,
        "personalToken": "",
        "securityOauthToken": "",
        "refreshToken": "",
        "needRefresh": False,
        "authInfo": {},
    }
    outer = {"payload": json.dumps(inner, ensure_ascii=False, separators=(",", ":")), "encodeVersion": "1"}
    body = encoding.encode(json.dumps(outer, ensure_ascii=False, separators=(",", ":")).encode())
    date = current_date()
    headers = {
        "cosy-machinetoken": machine_token,
        "cosy-machinetype": machine_type,
        "login-version": "v2",
        "appcode": APPCODE,
        "accept": "application/json",
        "accept-encoding": "identity",
        "cosy-version": "0.1.43",
        "cosy-clienttype": "5",
        "date": date,
        "signature": sign(date),
        "content-type": "application/json",
        "cosy-machineid": machine_id,
        "user-agent": "Go-http-client/2.0",
    }
    async with httpx.AsyncClient(timeout=15, **httpx_client_kwargs()) as client:
        response = await client.post("https://center.qoder.sh/algo/api/v3/user/status?Encode=1", content=body, headers=headers)
    if response.status_code != 200:
        raise RuntimeError(f"status HTTP {response.status_code} body={response.text}")
    return response.json()
