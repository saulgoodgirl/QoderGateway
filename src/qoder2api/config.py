from typing import Any

from .database import get_db
from .env import admin_password


def parse_account_uids(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    raw_str = str(raw).strip()
    if raw_str.startswith("[") and raw_str.endswith("]"):
        try:
            import json
            items = json.loads(raw_str)
            return [str(x).strip() for x in items if str(x).strip()]
        except Exception:
            pass
    return [x.strip() for x in raw_str.split(",") if x.strip()]


def load_config() -> dict[str, Any]:
    with get_db() as conn:
        res = conn.execute("SELECT value FROM settings WHERE key = 'auth_required'").fetchone()
        auth_required = (res[0] == "1") if res else False
        
        rows = conn.execute("SELECT api_key, COALESCE(name, '') as name, COALESCE(account_uid, '') as account_uid FROM allowed_keys").fetchall()
        allowed_keys = [r["api_key"] for r in rows]
        allowed_keys_detail = [
            {
                "api_key": r["api_key"],
                "name": r["name"],
                "account_uid": r["account_uid"],
                "account_uids": parse_account_uids(r["account_uid"]),
            }
            for r in rows
        ]
        
        res_tok = conn.execute("SELECT value FROM settings WHERE key = 'gateway_token'").fetchone()
        gateway_token = admin_password() or (res_tok[0] if res_tok else "admin")

    return {
        "auth_required": auth_required,
        "allowed_keys": allowed_keys,
        "allowed_keys_detail": allowed_keys_detail,
        "gateway_token": gateway_token
    }


def save_config(config: dict[str, Any]) -> None:
    with get_db() as conn:
        auth_required_str = "1" if config.get("auth_required", False) else "0"
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_required', ?)",
            (auth_required_str,)
        )
        
        if "gateway_token" in config:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('gateway_token', ?)",
                (str(config["gateway_token"]),)
            )
            
        if "allowed_keys_detail" in config and isinstance(config["allowed_keys_detail"], list):
            conn.execute("DELETE FROM allowed_keys")
            for item in config["allowed_keys_detail"]:
                if isinstance(item, dict):
                    k = str(item.get("api_key") or "").strip()
                    name = str(item.get("name") or "").strip()
                    acc_uids = item.get("account_uids")
                    if isinstance(acc_uids, list):
                        acc_uid = ",".join(str(x).strip() for x in acc_uids if str(x).strip())
                    else:
                        acc_uid = str(item.get("account_uid") or "").strip()
                    if k:
                        conn.execute(
                            "INSERT OR REPLACE INTO allowed_keys (api_key, name, account_uid) VALUES (?, ?, ?)",
                            (k, name, acc_uid)
                        )
        elif "allowed_keys" in config and isinstance(config["allowed_keys"], list):
            # Preserve existing names and account_uids if keys match
            existing_map = {}
            for r in conn.execute("SELECT api_key, name, account_uid FROM allowed_keys").fetchall():
                existing_map[r["api_key"]] = (r["name"] or "", r["account_uid"] or "")
            
            conn.execute("DELETE FROM allowed_keys")
            for key in config["allowed_keys"]:
                if isinstance(key, dict):
                    k = str(key.get("api_key") or "").strip()
                    name = str(key.get("name") or "").strip()
                    acc_uid = str(key.get("account_uid") or "").strip()
                elif isinstance(key, str):
                    k = key.strip()
                    name, acc_uid = existing_map.get(k, ("", ""))
                else:
                    continue
                if k:
                    conn.execute(
                        "INSERT OR REPLACE INTO allowed_keys (api_key, name, account_uid) VALUES (?, ?, ?)",
                        (k, name, acc_uid)
                    )
