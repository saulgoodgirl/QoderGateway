import copy
import uuid
from typing import Any

from .auth import (
    AuthIdentity,
    SessionContext,
    load_local_session,
    new_session,
    new_machine,
    fetch_user_status
)
from .database import get_db


def db_get_settings(key: str, default: str | None = None) -> str | None:
    with get_db() as conn:
        res = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return res[0] if res else default


def db_set_settings(key: str, value: str) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, str(value))
        )


def db_load_accounts() -> dict[str, Any]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM accounts").fetchall()
        accounts = []
        for r in rows:
            account = dict(r)
            account.pop("security_oauth_token", None)
            account.pop("refresh_token", None)
            account.pop("machine_id", None)
            accounts.append(account)
        active_uid = db_get_settings("active_uid")
        return {"accounts": accounts, "active_uid": active_uid}


async def import_current_auth() -> dict[str, Any]:
    """Decrypts current local auth files, queries quota status, and saves to SQLite."""
    sess = load_local_session()
    
    # Query current user quota and metadata from Qoder backend
    quota_val = 0
    is_exceeded = 0
    plan_val = "PLAN_TIER_PRO_TRIAL"
    user_tag_val = "Pro Trial"
    next_reset = None
    
    try:
        status_data = await fetch_user_status(
            sess.identity.uid,
            sess.machine_id,
            sess.machine_token,
            sess.machine_type
        )
        quota_val = status_data.get("quota", 0)
        is_exceeded = 1 if status_data.get("isQuotaExceeded", False) else 0
        plan_val = status_data.get("plan", "PLAN_TIER_PRO_TRIAL")
        user_tag_val = status_data.get("userTag", "Pro Trial")
        next_reset = status_data.get("nextResetAt")
    except Exception as e:
        # Fallback if network call fails
        print(f"Network error querying Qoder status: {e}")

    uid = sess.identity.uid
    name = sess.identity.name or "Unnamed"

    with get_db() as conn:
        # Check if already exists to keep enabled state
        existing = conn.execute("SELECT enabled FROM accounts WHERE uid = ?", (uid,)).fetchone()
        enabled = existing[0] if existing else 1

        conn.execute(
            """
            INSERT OR REPLACE INTO accounts (
                uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                enabled, last_status, last_error, quota, is_quota_exceeded, plan,
                user_tag, next_reset_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                uid, name, sess.identity.user_type, sess.identity.security_oauth_token,
                sess.identity.refresh_token, sess.machine_id, enabled, "ok", None,
                quota_val, is_exceeded, plan_val, user_tag_val, next_reset
            )
        )

    # Set as active if none set
    active_uid = db_get_settings("active_uid")
    if not active_uid:
        db_set_settings("active_uid", uid)

    return {
        "uid": uid,
        "name": name,
        "user_type": sess.identity.user_type,
        "enabled": bool(enabled),
        "last_status": "ok",
        "quota": quota_val,
        "is_quota_exceeded": bool(is_exceeded),
        "plan": plan_val,
        "user_tag": user_tag_val,
        "next_reset_at": next_reset
    }


def batch_import_accounts(records: list[dict]) -> dict:
    """批量导入账号（来自注册机导出的 JSON）。

    每条记录字段：email/password/name/user_id/token/refresh_token/expires_at/...
    返回 {"imported": n, "skipped": m}。
    """
    imported = 0
    skipped = 0
    with get_db() as conn:
        for rec in records:
            uid = str(rec.get("user_id") or "").strip()
            token = str(rec.get("token") or rec.get("security_oauth_token") or "").strip()
            if not uid and not token:
                skipped += 1
                continue
            if not uid:
                # 无 user_id 时用 token 前 12 位兜底主键
                uid = "tok_" + token[:24]
            existing = conn.execute("SELECT enabled FROM accounts WHERE uid = ?", (uid,)).fetchone()
            enabled = existing[0] if existing else 1
            conn.execute(
                """
                INSERT OR REPLACE INTO accounts (
                    uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                    enabled, last_status, last_error, quota, is_quota_exceeded, plan, user_tag, next_reset_at, token_expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL, 0, 0, 'PLAN_TIER_PRO_TRIAL', 'Pro Trial', NULL, ?)
                """,
                (
                    uid,
                    str(rec.get("name") or rec.get("email") or "Imported"),
                    "personal_standard",
                    token,
                    str(rec.get("refresh_token") or ""),
                    str(uuid.uuid4()),
                    enabled,
                    str(rec.get("expires_at") or ""),
                ),
            )
            imported += 1
        if not db_get_settings("active_uid"):
            active = conn.execute("SELECT uid FROM accounts WHERE enabled = 1 LIMIT 1").fetchone()
            if active:
                db_set_settings("active_uid", active["uid"])
    return {"imported": imported, "skipped": skipped}


def get_active_session() -> SessionContext:
    """Gets the session for the active account from database."""
    active_uid = db_get_settings("active_uid")
    
    account = None
    with get_db() as conn:
        if active_uid:
            res = conn.execute("SELECT * FROM accounts WHERE uid = ? AND enabled = 1", (active_uid,)).fetchone()
            if res:
                account = dict(res)
        
        if not account:
            # Fallback to first enabled account
            res = conn.execute("SELECT * FROM accounts WHERE enabled = 1 LIMIT 1").fetchone()
            if res:
                account = dict(res)
                db_set_settings("active_uid", account["uid"])

    if not account:
        raise ValueError("No active or enabled accounts found in database. Please import or configure an account.")

    region = account.get("region") or "cn"
    identity = AuthIdentity(
        name=account["name"],
        aid=account["uid"],
        uid=account["uid"],
        yx_uid="",
        organization_id="",
        organization_name="",
        user_type=account["user_type"],
        security_oauth_token=account["security_oauth_token"],
        refresh_token=account["refresh_token"],
        region=region,
    )
    
    _, machine_token, machine_type = new_machine()
    return new_session(
        identity,
        account["machine_id"],
        machine_token,
        machine_type
    )


def rotate_next_account(failed_uid: str, error_msg: str) -> SessionContext:
    """Marks failed account in database, rotates to the next enabled, and returns it."""
    with get_db() as conn:
        conn.execute(
            "UPDATE accounts SET last_status = 'failed', last_error = ? WHERE uid = ?",
            (error_msg, failed_uid)
        )
        
        # Get all enabled accounts
        rows = conn.execute("SELECT * FROM accounts WHERE enabled = 1").fetchall()
        
    enabled_accounts = [dict(r) for r in rows]
    if not enabled_accounts:
        raise ValueError("All enabled accounts have failed or no enabled accounts exist.")

    # Find next cyclic account
    next_acc = None
    try:
        failed_idx = next(i for i, acc in enumerate(enabled_accounts) if acc["uid"] == failed_uid)
        next_acc = enabled_accounts[(failed_idx + 1) % len(enabled_accounts)]
    except StopIteration:
        next_acc = enabled_accounts[0]

    db_set_settings("active_uid", next_acc["uid"])
    
    region = next_acc.get("region") or "cn"
    identity = AuthIdentity(
        name=next_acc["name"],
        aid=next_acc["uid"],
        uid=next_acc["uid"],
        yx_uid="",
        organization_id="",
        organization_name="",
        user_type=next_acc["user_type"],
        security_oauth_token=next_acc["security_oauth_token"],
        refresh_token=next_acc["refresh_token"],
        region=region,
    )
    _, machine_token, machine_type = new_machine()
    return new_session(
        identity,
        next_acc["machine_id"],
        machine_token,
        machine_type
    )
