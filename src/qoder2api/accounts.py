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
            mode = str(account.get("api_mode") or "")
            if not mode:
                mode = "all" if account.get("api_enabled", 1) else "disabled"
            account["api_mode"] = mode
            account["api_enabled"] = (mode != "disabled")
            account["enabled"] = bool(account.get("enabled", 1))
            u_type = str(account.get("user_type") or "").lower()
            plan_val = str(account.get("plan") or "")
            account["is_enterprise"] = (plan_val == "Teams" or "team" in u_type or "org" in u_type or "enterprise" in u_type)
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


def get_active_session(target_account: str | list[str] | None = None) -> SessionContext:
    """Gets the session for the active account from database.
    
    - If target_account is a list of strings:
      Targets that specific subset of accounts. If active_uid is in this subset, use it;
      otherwise pick the first enabled non-disabled account in the subset.
    - If target_account is a single string:
      Searches for matching account (by uid or name).
    - If target_account is None:
      Defaults to general pool (api_mode = 'all').
    """
    account = None
    with get_db() as conn:
        if isinstance(target_account, list) and len(target_account) > 0:
            clean_uids = [str(x).strip() for x in target_account if str(x).strip()]
            if len(clean_uids) == 1:
                target_str = clean_uids[0]
                res = conn.execute(
                    """
                    SELECT * FROM accounts 
                    WHERE enabled = 1 
                      AND COALESCE(api_mode, 'all') != 'disabled'
                      AND (uid = ? OR name = ? OR uid LIKE ?)
                    LIMIT 1
                    """,
                    (target_str, target_str, f"{target_str}%")
                ).fetchone()
                if res:
                    account = dict(res)
                else:
                    raise ValueError(f"指定的 Qoder 账号【{target_str}】未找到、未启用或已设为禁止 API 调用。")
            elif len(clean_uids) > 1:
                placeholders = ",".join("?" for _ in clean_uids)
                active_uid = db_get_settings("active_uid")
                if active_uid and active_uid in clean_uids:
                    res = conn.execute(
                        "SELECT * FROM accounts WHERE uid = ? AND enabled = 1 AND COALESCE(api_mode, 'all') != 'disabled'",
                        (active_uid,)
                    ).fetchone()
                    if res:
                        account = dict(res)
                if not account:
                    res = conn.execute(
                        f"""
                        SELECT * FROM accounts 
                        WHERE enabled = 1 
                          AND COALESCE(api_mode, 'all') != 'disabled'
                          AND (uid IN ({placeholders}) OR name IN ({placeholders}))
                        LIMIT 1
                        """,
                        (*clean_uids, *clean_uids)
                    ).fetchone()
                    if res:
                        account = dict(res)
                        db_set_settings("active_uid", account["uid"])
                if not account:
                    raise ValueError(f"所选的 {len(clean_uids)} 个指定账号中无可用账号（未找到、未启用或已禁用）。")
        elif isinstance(target_account, str) and target_account.strip():
            target_str = target_account.strip()
            res = conn.execute(
                """
                SELECT * FROM accounts 
                WHERE enabled = 1 
                  AND COALESCE(api_mode, 'all') != 'disabled'
                  AND (uid = ? OR name = ? OR uid LIKE ?)
                LIMIT 1
                """,
                (target_str, target_str, f"{target_str}%")
            ).fetchone()
            if res:
                account = dict(res)
            else:
                raise ValueError(f"指定的 Qoder 账号【{target_account}】未找到、未启用或已设为禁止 API 调用。")
        else:
            active_uid = db_get_settings("active_uid")
            if active_uid:
                res = conn.execute(
                    "SELECT * FROM accounts WHERE uid = ? AND enabled = 1 AND COALESCE(api_mode, 'all') = 'all'",
                    (active_uid,)
                ).fetchone()
                if res:
                    account = dict(res)
            
            if not account:
                # Fallback to first enabled and general-pool allowed account
                res = conn.execute(
                    "SELECT * FROM accounts WHERE enabled = 1 AND COALESCE(api_mode, 'all') = 'all' LIMIT 1"
                ).fetchone()
                if res:
                    account = dict(res)
                    db_set_settings("active_uid", account["uid"])

    if not account:
        raise ValueError("账号池中没有可供公共调度的有效账号。请在控制台将至少一个账号的 API 模式设为【全部调用】。")

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


def rotate_next_account(failed_uid: str, error_msg: str, target_account: str | list[str] | None = None) -> SessionContext:
    """Marks failed account in database, rotates to the next enabled, and returns it.
    - If target_account is a single string: does not rotate (raises error).
    - If target_account is a list of strings: rotates ONLY within this selected subset!
    - If target_account is None: rotates within all general pool accounts (api_mode = 'all').
    """
    with get_db() as conn:
        conn.execute(
            "UPDATE accounts SET last_status = 'failed', last_error = ? WHERE uid = ?",
            (error_msg, failed_uid)
        )
        
        if isinstance(target_account, str) and target_account.strip():
            raise RuntimeError(f"单独指定的账号【{target_account}】调用失败: {error_msg}")

        if isinstance(target_account, list) and len(target_account) > 0:
            clean_uids = [str(x).strip() for x in target_account if str(x).strip()]
            if len(clean_uids) <= 1:
                raise RuntimeError(f"指定账号调用失败: {error_msg}")
            placeholders = ",".join("?" for _ in clean_uids)
            rows = conn.execute(
                f"""
                SELECT * FROM accounts 
                WHERE enabled = 1 
                  AND COALESCE(api_mode, 'all') != 'disabled'
                  AND (uid IN ({placeholders}) OR name IN ({placeholders}))
                """,
                (*clean_uids, *clean_uids)
            ).fetchall()
        else:
            # Get all enabled accounts eligible for general pool API routing
            rows = conn.execute("SELECT * FROM accounts WHERE enabled = 1 AND COALESCE(api_mode, 'all') = 'all'").fetchall()
        
    enabled_accounts = [dict(r) for r in rows]
    if not enabled_accounts:
        raise ValueError("候选账号均已失败或无可用账号。")

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
