"""
Token 刷新与限额查询（openapi.qoder.sh）

- 刷新：POST /api/v1/deviceToken/refresh（drt-）或 /api/v1/jobToken/refresh（jrt-）
- 限额：GET /api/v2/quota/usage
- 后台定时刷新线程：每 6 小时刷新一次全部 enabled 账号的 token
"""
from __future__ import annotations

import threading
import time
from typing import Any

import httpx

from .database import get_db

OPENAPI_GLOBAL = "https://openapi.qoder.sh"
OPENAPI_CN = "https://openapi.qoder.com.cn"
UA = "pi-provider-qoder"
REFRESH_INTERVAL = 6 * 3600  # 6 小时


def get_openapi_url(region: str = "cn") -> str:
    return OPENAPI_CN if (region or "").lower() == "cn" else OPENAPI_GLOBAL


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": UA,
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }


def refresh_one_account(uid: str) -> dict[str, Any]:
    """用 refresh_token 刷新单个账号的 dt-/drt-，并回写数据库。"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM accounts WHERE uid = ?", (uid,)
        ).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}
    rt = (row["refresh_token"] or "").strip()
    if not rt:
        return {"ok": False, "uid": uid, "error": "无 refresh_token"}

    region = row["region"] if "region" in row.keys() else "cn"
    base_api = get_openapi_url(region)

    # drt- → deviceToken/refresh；jrt- → jobToken/refresh
    if rt.startswith("jrt-"):
        url = f"{base_api}/api/v1/jobToken/refresh"
        token_key = "token"
    else:
        url = f"{base_api}/api/v1/deviceToken/refresh"
        token_key = "device_token"

    try:
        r = httpx.post(url, json={"refresh_token": rt}, headers=_headers(), timeout=25)
    except httpx.HTTPError as e:
        return {"ok": False, "uid": uid, "error": f"网络错误: {e}"}

    if r.status_code != 200:
        return {"ok": False, "uid": uid, "error": f"HTTP {r.status_code}: {r.text[:160]}"}

    d = r.json()
    new_tok = str(d.get(token_key) or d.get("token") or "").strip()
    new_rt = str(d.get("refresh_token") or "").strip()
    if not new_tok:
        return {"ok": False, "uid": uid, "error": "响应缺少 token"}
    expires_at = d.get("expires_at") or ""

    with get_db() as conn:
        conn.execute(
            "UPDATE accounts SET security_oauth_token = ?, refresh_token = ?, "
            "token_expires_at = ?, last_status = 'ok', last_error = NULL WHERE uid = ?",
            (new_tok, new_rt, expires_at, uid),
        )
    return {"ok": True, "uid": uid, "name": row["name"], "expires_at": expires_at}


def refresh_all_account_tokens() -> dict[str, Any]:
    """刷新所有 enabled 且有 refresh_token 的账号。"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT uid FROM accounts WHERE enabled = 1 AND refresh_token IS NOT NULL AND refresh_token != ''"
        ).fetchall()
    results = [refresh_one_account(r["uid"]) for r in rows]
    ok = sum(1 for x in results if x.get("ok"))
    return {
        "ok": ok,
        "failed": len(results) - ok,
        "total": len(results),
        "results": results,
    }


def get_account_quota(uid: str) -> dict[str, Any]:
    """查询单个账号限额（GET /api/v2/quota/usage）。"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM accounts WHERE uid = ?", (uid,)
        ).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}
    tok = row["security_oauth_token"] or ""
    if not tok:
        return {"ok": False, "uid": uid, "error": "无 token"}
    region = row["region"] if "region" in row.keys() else "cn"
    base_api = get_openapi_url(region)
    try:
        r = httpx.get(
            f"{base_api}/api/v2/quota/usage",
            headers={"Authorization": f"Bearer {tok}", "Accept": "application/json", "User-Agent": UA},
            timeout=20,
        )
    except httpx.HTTPError as e:
        return {"ok": False, "uid": uid, "error": f"网络错误: {e}"}
    if r.status_code != 200:
        return {"ok": False, "uid": uid, "error": f"HTTP {r.status_code}: {r.text[:160]}"}

    q_data = r.json()
    try:
        uq = q_data.get("userQuota") or {}
        addon = q_data.get("addOnQuota") or {}
        org = q_data.get("orgResourcePackage") or {}
        total_remaining = float(uq.get("remaining", 0.0)) + float(addon.get("remaining", 0.0)) + float(org.get("remaining", 0.0))
        is_exceeded = 1 if (bool(q_data.get("isQuotaExceeded")) or total_remaining <= 0) else 0
        
        # 准确识别用户与账号类别（企业/团队用户 vs 个人用户）
        raw_u_type = str(q_data.get("userType") or row["user_type"] or "").strip().lower()
        has_org_pkg = bool(org.get("available")) or float(org.get("remaining", 0.0)) > 0
        if "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type or has_org_pkg:
            user_type = "teams"
            plan = "Teams"
            user_tag = "Teams (Org Package)" if has_org_pkg else "Teams"
        else:
            user_type = "personal"
            plan = "Personal"
            user_tag = "Resource Pack" if float(addon.get("remaining", 0.0)) > 0 and float(uq.get("remaining", 0.0)) <= 0 else plan

        with get_db() as conn:
            conn.execute(
                "UPDATE accounts SET quota = ?, is_quota_exceeded = ?, user_type = ?, plan = ?, user_tag = ? WHERE uid = ?",
                (int(total_remaining), is_exceeded, user_type, plan, user_tag, uid)
            )
    except Exception:
        pass

    return {"ok": True, "uid": uid, "name": row["name"], "quota": q_data}


def get_all_accounts_quota() -> dict[str, Any]:
    """查询所有 enabled 账号的限额。"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT uid, name FROM accounts WHERE enabled = 1 AND security_oauth_token IS NOT NULL AND security_oauth_token != ''"
        ).fetchall()
    quotas = [get_account_quota(r["uid"]) for r in rows]
    return {"total": len(quotas), "quotas": quotas}


# ---------------------------------------------------------------------------
# 后台定时刷新
# ---------------------------------------------------------------------------
_refresh_thread: threading.Thread | None = None
_refresh_lock = threading.Lock()


def _refresh_loop() -> None:
    while True:
        time.sleep(REFRESH_INTERVAL)
        try:
            refresh_all_account_tokens()
        except Exception:
            pass


def start_refresh_loop() -> None:
    """启动后台定时刷新线程（幂等）。"""
    global _refresh_thread
    with _refresh_lock:
        if _refresh_thread is None or not _refresh_thread.is_alive():
            _refresh_thread = threading.Thread(target=_refresh_loop, daemon=True)
            _refresh_thread.start()
