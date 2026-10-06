import argparse
import collections
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Header, Depends, Body, Request
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .auth import SessionContext, create_session, load_local_session
from .bridge import complete_openai_response, stream_openai_response
from .config import load_config, save_config
from .database import get_db
from .env import env_bool
from .accounts import (
    db_load_accounts,
    db_get_settings,
    db_set_settings,
    import_current_auth,
    import_local_zcode_account,
    add_provider_account,
    get_active_account_record,
    get_active_session,
    rotate_next_account,
    batch_import_accounts,
)
from .registrar import get_registrar_status, start_registration, stop_registration
from .tokens import (
    refresh_all_account_tokens,
    refresh_one_account,
    get_account_quota,
    get_all_accounts_quota,
    start_refresh_loop,
)
from .checkin import (
    start_checkin_loop,
    checkin_all_accounts,
    claim_checkin,
    get_all_accounts_checkin_overview,
)
from .zcode import (
    forward_zcode_stream,
    forward_zcode_complete,
    ping_zcode_account,
    load_local_zcode_credentials,
    init_zcode_cli_oauth,
    poll_zcode_cli_oauth,
    parse_zcode_credentials_dict,
)
from .oauth_device import (
    initiate_qoder_device_flow,
    poll_qoder_device_token,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

BASE_DIR = os.path.dirname(__file__)
INDEX_HTML = Path(BASE_DIR) / "static" / "index.html"
CONSOLE_HTML = Path(BASE_DIR) / "static" / "console.html"
DOCS_HTML = Path(BASE_DIR) / "static" / "docs.html"
FAVICON_SVG = Path(BASE_DIR) / "static" / "favicon.svg"
ICONS_SVG = Path(BASE_DIR) / "static" / "icons.svg"

app = FastAPI(title="GETIT Gateway", description="GETIT · Universal Multi-Provider AI Aggregation Gateway")
app.mount("/assets", StaticFiles(directory=os.path.join(BASE_DIR, "static", "assets")), name="assets")


@app.get("/favicon.svg", include_in_schema=False)
@app.get("/favicon.ico", include_in_schema=False)
async def get_favicon():
    if FAVICON_SVG.exists():
        return FileResponse(FAVICON_SVG, media_type="image/svg+xml")
    return Response(status_code=404)


@app.get("/icons.svg", include_in_schema=False)
async def get_icons():
    if ICONS_SVG.exists():
        return FileResponse(ICONS_SVG, media_type="image/svg+xml")
    return Response(status_code=404)


@app.on_event("startup")
def on_startup():
    start_refresh_loop()
    start_checkin_loop()
    add_log("Background token refresh & daily auto-checkin loops started.")

_session: SessionContext | None = None
_local_auth_error: str | None = None

logs_queue = collections.deque(maxlen=150)


def add_log(msg: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted = f"[{timestamp}] [{level}] {msg}"
    logs_queue.append(formatted)
    print(formatted)


# Add initial logs
add_log("Qoder2API Python Bridge initialized.")



def check_gateway_token(x_gateway_token: str | None = Header(default=None)):
    config = load_config()
    gateway_token = config.get("gateway_token", "admin")
    if not x_gateway_token or x_gateway_token != gateway_token:
        raise HTTPException(status_code=401, detail="Unauthorized gateway access")


@app.post("/ui/verify")
async def verify_gateway(payload: dict[str, Any]) -> dict[str, Any]:
    token = payload.get("token", "").strip()
    config = load_config()
    if token == config.get("gateway_token", "admin"):
        return {"status": "ok"}
    raise HTTPException(status_code=401, detail="Invalid Gateway Token")


async def get_session(target_account: str | None = None) -> SessionContext:
    global _local_auth_error
    data = db_load_accounts()
    if not data["accounts"]:
        # Try importing environment PAT if available
        pat = os.getenv("QODER_PAT", "").strip()
        if pat:
            add_log("No accounts stored. Importing QODER_PAT from environment...")
            try:
                sess = await create_session(pat)
                with get_db() as conn:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO accounts (
                            uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                            enabled, api_enabled, api_mode, last_status, last_error, region
                        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'all', 'ok', NULL, ?)
                        """,
                        (sess.identity.uid, sess.identity.name or "Environment PAT", sess.identity.user_type,
                         sess.identity.security_oauth_token, sess.identity.refresh_token, sess.machine_id, sess.identity.region)
                    )
                db_set_settings("active_uid", sess.identity.uid)
                add_log(f"Imported environment PAT as account: {sess.identity.name}")
                _local_auth_error = None
            except Exception as exc:
                add_log(f"Failed to import environment PAT: {exc}", "ERROR")

        data = db_load_accounts()
        if not data["accounts"]:
            add_log("No accounts stored. Attempting to auto-import current local Qoder auth session...")
            try:
                await import_current_auth()
                add_log("Auto-imported current local Qoder session successfully.")
                _local_auth_error = None
            except Exception as exc:
                _local_auth_error = str(exc)
                add_log(f"Auto-import of local session failed: {exc}", "WARNING")

    try:
        return get_active_session(target_account=target_account)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"No active session available: {exc}. Please configure/import an account first."
        )


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    if not env_bool("QODER_ENABLE_LANDING", True):
        raise HTTPException(status_code=404, detail="Landing page is disabled")
    return HTMLResponse(INDEX_HTML.read_text(encoding="utf-8"))


@app.get("/console", response_class=HTMLResponse)
async def console() -> HTMLResponse:
    return HTMLResponse(CONSOLE_HTML.read_text(encoding="utf-8"))


@app.get("/documents", response_class=HTMLResponse)
async def documents() -> HTMLResponse:
    if not env_bool("QODER_ENABLE_DOCUMENTS", True):
        raise HTTPException(status_code=404, detail="Documents page is disabled")
    return HTMLResponse(DOCS_HTML.read_text(encoding="utf-8"))


@app.get("/ui/status")
async def status(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    global _local_auth_error
    data = db_load_accounts()
    if not data["accounts"]:
        try:
            await get_session()
            data = db_load_accounts()
        except Exception:
            pass

    active_uid = data.get("active_uid")
    active_acc = None
    for acc in data["accounts"]:
        if acc["uid"] == active_uid:
            active_acc = acc
            break

    # 若未命中 active_uid 但存在账号，自动回退到第一个有效账号
    if active_acc is None and data["accounts"]:
        for acc in data["accounts"]:
            if acc.get("enabled", True):
                active_acc = acc
                break
        if active_acc is None:
            active_acc = data["accounts"][0]

    if active_acc is not None:
        return {
            "ready": True,
            "mode": "accounts",
            "username": active_acc["name"],
            "uid": active_acc["uid"],
            "user_type": active_acc["user_type"],
            "error": None,
            "accounts_count": len(data["accounts"])
        }
    return {
        "ready": False,
        "mode": "none",
        "username": None,
        "uid": None,
        "user_type": None,
        "error": _local_auth_error,
        "accounts_count": len(data["accounts"])
    }


@app.get("/ui/accounts")
async def get_accounts(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    return db_load_accounts()


@app.post("/ui/accounts/import")
async def import_account(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    try:
        acc = await import_current_auth()
        add_log(f"Imported local Qoder session account: {acc['name']}")
        return {"status": "ok", "account": acc}
    except Exception as exc:
        msg = str(exc)
        if "not found" in msg.lower() or "auth files" in msg.lower():
            msg = "云端 Linux 服务器（Docker）未安装 Qoder 桌面客户端，无法读取本地客户端文件。请使用【PAT 令牌添加】或【批量导入】。"
        add_log(f"Failed to import local session account: {exc}", "ERROR")
        raise HTTPException(status_code=400, detail=msg)


@app.post("/ui/accounts/batch-import")
async def batch_import(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """批量导入注册机导出的 JSON：{"accounts": [{user_id, token, refresh_token, ...}]}。"""
    records = payload.get("accounts") or payload.get("records") or []
    if not isinstance(records, list) or not records:
        raise HTTPException(status_code=400, detail="accounts 数组为空")
    result = batch_import_accounts(records)
    add_log(f"Batch imported {result['imported']} accounts (skipped {result['skipped']})")
    return {"status": "ok", **result}


@app.post("/ui/accounts/select")
async def select_account(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    uid = payload.get("uid")
    if not uid:
        raise HTTPException(status_code=400, detail="uid is required")
    with get_db() as conn:
        res = conn.execute("SELECT uid FROM accounts WHERE uid = ?", (uid,)).fetchone()
        if not res:
            raise HTTPException(status_code=404, detail="Account not found")
    db_set_settings("active_uid", uid)
    add_log(f"Selected active account UID: {uid}")
    return {"status": "ok"}


@app.post("/ui/accounts/toggle")
async def toggle_account(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    uid = payload.get("uid")
    enabled = bool(payload.get("enabled", True))
    if not uid:
        raise HTTPException(status_code=400, detail="uid is required")
    enabled_val = 1 if enabled else 0
    with get_db() as conn:
        res = conn.execute("UPDATE accounts SET enabled = ? WHERE uid = ?", (enabled_val, uid))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
    add_log(f"Account toggle enabled={enabled} for UID: {uid}")
    return {"status": "ok"}


@app.post("/ui/accounts/set-api-mode")
async def set_account_api_mode(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """设置账号的 API 调度模式:
    - 'all': 全部调用（默认，参与公共池常规轮询与所有通用 API 调用）
    - 'dedicated': 专属单独调用（普通请求不消耗，仅在请求显式指定该账号时才调用）
    - 'disabled': 完全排除调用（不参与任何 API 响应，仅保留每日自动签到与令牌保活）
    """
    uid = payload.get("uid")
    api_mode = str(payload.get("api_mode", "all")).strip().lower()
    if not uid:
        raise HTTPException(status_code=400, detail="uid is required")
    if api_mode not in ("all", "dedicated", "disabled"):
        raise HTTPException(status_code=400, detail="api_mode must be 'all', 'dedicated', or 'disabled'")
    
    api_val = 0 if api_mode == "disabled" else 1
    rotated_to = None
    with get_db() as conn:
        res = conn.execute("UPDATE accounts SET api_mode = ?, api_enabled = ? WHERE uid = ?", (api_mode, api_val, uid))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")

        # If current active account was changed to dedicated or disabled, rotate active_uid to an eligible 'all' account
        active_setting = conn.execute("SELECT value FROM settings WHERE key = 'active_uid'").fetchone()
        active_uid = active_setting[0] if active_setting else None
        if active_uid == uid and api_mode != "all":
            next_eligible = conn.execute(
                "SELECT uid FROM accounts WHERE enabled = 1 AND COALESCE(api_mode, 'all') = 'all' LIMIT 1"
            ).fetchone()
            if next_eligible:
                rotated_to = next_eligible[0]
                conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_uid', ?)", (rotated_to,))

    if rotated_to:
        add_log(f"Active pool account was rotated to {rotated_to}")

    add_log(f"Account API mode set to '{api_mode}' for UID: {uid}")
    return {"status": "ok", "uid": uid, "api_mode": api_mode}


@app.post("/ui/accounts/toggle-api")
async def toggle_account_api(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    uid = payload.get("uid")
    api_enabled = bool(payload.get("api_enabled", True))
    if not uid:
        raise HTTPException(status_code=400, detail="uid is required")
    api_mode = "all" if api_enabled else "disabled"
    return await set_account_api_mode({"uid": uid, "api_mode": api_mode}, verify=verify)


@app.post("/ui/accounts/refresh-tokens")
async def refresh_account_tokens(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """手动触发：刷新所有账号的 token（drt- → deviceToken/refresh）。"""
    result = refresh_all_account_tokens()
    add_log(f"Token refresh: ok={result['ok']} failed={result['failed']} total={result['total']}")
    return {"status": "ok", **result}


@app.get("/ui/accounts/quota")
async def accounts_quota(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """查看所有启用账号的限额（GET /api/v2/quota/usage）。"""
    return get_all_accounts_quota()


@app.delete("/ui/accounts/{uid}")
async def delete_account(uid: str, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    with get_db() as conn:
        res = conn.execute("DELETE FROM accounts WHERE uid = ?", (uid,))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
            
    active_uid = db_get_settings("active_uid")
    if active_uid == uid:
        data = db_load_accounts()
        new_active = data["accounts"][0]["uid"] if data["accounts"] else None
        if new_active:
            db_set_settings("active_uid", new_active)
        else:
            with get_db() as conn:
                conn.execute("DELETE FROM settings WHERE key = 'active_uid'")
    add_log(f"Deleted account UID: {uid}")
    return {"status": "ok"}


@app.get("/ui/logs")
async def get_logs(verify: None = Depends(check_gateway_token)) -> list[str]:
    return list(logs_queue)


@app.get("/ui/checkin/status")
async def checkin_status_endpoint(force: bool = False, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """获取所有启用账号的每日签到状态与算力统计概览。"""
    from starlette.concurrency import run_in_threadpool
    try:
        return await run_in_threadpool(get_all_accounts_checkin_overview, force=force)
    except Exception as exc:
        add_log(f"Checkin status query error: {exc}", "ERROR")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/ui/checkin/claim")
async def checkin_claim_endpoint(payload: dict[str, Any] | None = None, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """执行每日签到。传入 {"uid": "..."} 签到单个账号，否则签到全部 enabled 账号。"""
    from starlette.concurrency import run_in_threadpool
    payload = payload or {}
    uid = payload.get("uid")
    if uid:
        res = await run_in_threadpool(claim_checkin, uid)
        msg = res.get("message") or res.get("error")
        add_log(f"Manual check-in for {res.get('name', uid)}: {msg}")
        return {"status": "ok", "result": res}

    res = await run_in_threadpool(checkin_all_accounts)
    add_log(
        f"Manual check-in all: claimed={res['claimed']}, already={res['already_claimed']}, "
        f"failed={res['failed']}, credits={res['total_credits']}"
    )
    return {"status": "ok", "result": res, **res}


@app.post("/ui/registrar/start")
async def registrar_start(payload: dict[str, Any] | None = None, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """启动注册机（仅限本地环境可用，云端已禁用）。"""
    if not env_bool("ENABLE_REGISTRAR", False):
        raise HTTPException(status_code=403, detail="自动注册机仅限本地部署环境运行，云端已禁用此功能。导出的 accounts.json 请通过批量导入上传。")
    payload = payload or {}
    try:
        parents = int(payload.get("parents", 2))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="parents 参数无效")
    return start_registration(parents=parents)


@app.post("/ui/registrar/stop")
async def registrar_stop(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """请求停止注册机。"""
    if not env_bool("ENABLE_REGISTRAR", False):
        raise HTTPException(status_code=403, detail="自动注册机仅限本地部署环境运行，云端已禁用此功能。")
    return stop_registration()


@app.get("/ui/registrar/status")
async def registrar_status(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """查询注册机任务状态。"""
    if not env_bool("ENABLE_REGISTRAR", False):
        return {"running": False, "stage": "disabled", "logs": ["自动注册机仅限本地独立环境运行，云端环境已禁用此功能。"]}
    return get_registrar_status()


@app.post("/ui/accounts/zcode-import")
async def zcode_import(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """一键导入本机 ~/.zcode/v2/credentials.json 中已解密的 ZCode 凭据。"""
    try:
        res = import_local_zcode_account()
        add_log(f"Imported local ZCode account: {res['name']} ({res['uid']})")
        return {"status": "ok", "account": res}
    except Exception as exc:
        add_log(f"Failed to import local ZCode account: {exc}", "ERROR")
        raise HTTPException(status_code=400, detail=f"导入本机 ZCode 凭据失败: {exc}")


@app.post("/ui/oauth/zcode/init")
async def oauth_zcode_init(payload: dict[str, Any] = Body(default={}), verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """发起 ZCode CLI 免密网页授权（与 CreditDaddy/官方 CLI 一致，无需本地客户端）。"""
    provider = str(payload.get("provider") or "bigmodel").strip().lower()
    try:
        data = await init_zcode_cli_oauth(provider=provider)
        add_log(f"Initiated ZCode CLI OAuth flow (Provider: {provider}, Flow: {data['flow_id']})")
        return data
    except Exception as exc:
        add_log(f"Failed to initiate ZCode CLI OAuth: {exc}", "ERROR")
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/ui/oauth/zcode/poll")
async def oauth_zcode_poll(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """轮询 ZCode CLI 授权结果，授权成功后自动录入账号。"""
    flow_id = str(payload.get("flow_id") or "").strip()
    poll_token = str(payload.get("poll_token") or "").strip()
    provider = str(payload.get("provider") or "bigmodel").strip().lower()

    if not flow_id or not poll_token:
        raise HTTPException(status_code=400, detail="Missing flow_id or poll_token")

    try:
        res = await poll_zcode_cli_oauth(flow_id=flow_id, poll_token=poll_token, provider=provider)
        if res.get("status") == "ready":
            uid = res["uid"]
            name = res["name"]
            token = res["token"]
            jwt = res.get("jwt") or ""
            with get_db() as conn:
                existing = conn.execute("SELECT enabled FROM accounts WHERE uid = ?", (uid,)).fetchone()
                enabled = existing[0] if existing else 1
                conn.execute(
                    """
                    INSERT OR REPLACE INTO accounts (
                        uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                        enabled, last_status, last_error, quota, is_quota_exceeded, plan,
                        user_tag, region, provider, base_url
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL, 200000000, 0, 'ZCode Free/Pro', 'BigModel', 'cn', 'zcode', '')
                    """,
                    (uid, name, "zcode_user", token, jwt, str(uuid.uuid4()), enabled),
                )
                if not db_get_settings("active_uid"):
                    db_set_settings("active_uid", uid)
            add_log(f"ZCode CLI OAuth authorization succeeded! Account: {name} ({uid})")
            return {
                "status": "ready",
                "account": {
                    "uid": uid,
                    "name": name,
                    "provider": "zcode",
                    "enabled": bool(enabled),
                },
            }
        return res
    except Exception as exc:
        add_log(f"ZCode CLI OAuth poll error: {exc}", "ERROR")
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/ui/accounts/zcode-decrypt")
async def zcode_decrypt(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """解析并解密用户上传或粘贴的 ZCode credentials.json，自动入库。"""
    creds_raw = payload.get("credentials")
    if isinstance(creds_raw, str):
        try:
            creds_data = json.loads(creds_raw)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON string: {exc}")
    elif isinstance(creds_raw, dict):
        creds_data = creds_raw
    else:
        raise HTTPException(status_code=400, detail="Missing credentials data")

    secret = payload.get("secret")
    try:
        parsed = parse_zcode_credentials_dict(creds_data, secret=secret)
        uid = parsed["uid"]
        name = parsed["name"]
        token = parsed["token"]
        jwt = parsed.get("jwt") or ""
        with get_db() as conn:
            existing = conn.execute("SELECT enabled FROM accounts WHERE uid = ?", (uid,)).fetchone()
            enabled = existing[0] if existing else 1
            conn.execute(
                """
                INSERT OR REPLACE INTO accounts (
                    uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                    enabled, last_status, last_error, quota, is_quota_exceeded, plan,
                    user_tag, region, provider, base_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL, 200000000, 0, 'ZCode Free/Pro', 'BigModel', 'cn', 'zcode', '')
                """,
                (uid, name, "zcode_user", token, jwt, str(uuid.uuid4()), enabled),
            )
            if not db_get_settings("active_uid"):
                db_set_settings("active_uid", uid)
        add_log(f"Decrypted and registered ZCode account: {name} ({uid})")
        return {"status": "ok", "account": {"uid": uid, "name": name, "provider": "zcode"}}
    except Exception as exc:
        add_log(f"Failed to decrypt ZCode credentials: {exc}", "ERROR")
        raise HTTPException(status_code=400, detail=f"解密 ZCode 凭据失败: {exc}")


@app.post("/ui/oauth/qoder/device-code")
async def oauth_qoder_device_code(payload: dict[str, Any] = Body(default={}), verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """发起 Qoder OAuth 2.0 设备授权流（对齐 9Router 方案）。"""
    region = str(payload.get("region") or "cn").strip().lower()
    data = initiate_qoder_device_flow(region=region)
    add_log(f"Initiated Qoder OAuth device authorization (User Code: {data['user_code']}, Region: {region})")
    return data


@app.post("/ui/oauth/qoder/poll")
async def oauth_qoder_poll(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """轮询 Qoder 设备授权 Token，成功后自动入库（对齐 9Router 方案）。"""
    nonce = str(payload.get("nonce") or payload.get("device_code") or "").strip()
    verifier = str(payload.get("verifier") or payload.get("code_verifier") or "").strip()
    machine_id = str(payload.get("machine_id") or "").strip()
    region = str(payload.get("region") or "cn").strip().lower()

    if not nonce or not verifier:
        raise HTTPException(status_code=400, detail="Missing nonce or verifier")

    res = await poll_qoder_device_token(nonce=nonce, verifier=verifier, machine_id=machine_id, region=region)
    if res.get("status") == "ok":
        add_log(f"Qoder OAuth device login succeeded! Account: {res['account']['name']} ({res['account']['uid']})")
    return res


@app.post("/ui/accounts/add-provider")
async def add_provider_endpoint(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """手动添加或更新指定 Provider 的账号（支持 ZCode、自定义 OpenAI 兼容接口等）。"""
    provider = str(payload.get("provider") or "zcode").strip().lower()
    uid = str(payload.get("uid") or "").strip()
    name = str(payload.get("name") or "").strip()
    token = str(payload.get("token") or payload.get("apiKey") or payload.get("api_key") or "").strip()
    base_url = str(payload.get("base_url") or payload.get("baseUrl") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="API Key / Token is required")

    res = add_provider_account(provider=provider, uid=uid, name=name, token=token, base_url=base_url)
    add_log(f"Added provider account: [{provider.upper()}] {res['name']} ({res['uid']})")
    return {"status": "ok", "account": res}


@app.get("/ui/config")
async def get_ui_config(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    return load_config()


@app.post("/ui/config")
async def post_ui_config(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    save_config(payload)
    add_log("API Key configuration updated.")
    return {"status": "ok"}


@app.post("/ui/session")
async def set_session(payload: dict[str, Any], verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    global _local_auth_error
    pat = str(payload.get("pat") or os.getenv("QODER_PAT", "")).strip()
    name_override = str(payload.get("name") or "").strip()
    if not pat:
        raise HTTPException(status_code=400, detail="PAT is required")
    try:
        add_log("Attempting to save session from PAT...")
        sess = await create_session(pat)
        account_name = name_override or sess.identity.name or "PAT Account"
        
        # Insert or update in SQLite
        with get_db() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO accounts (
                    uid, name, user_type, security_oauth_token, refresh_token, machine_id,
                    enabled, last_status, last_error, region
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 'ok', NULL, ?)
                """,
                (sess.identity.uid, account_name, sess.identity.user_type,
                 sess.identity.security_oauth_token, sess.identity.refresh_token, sess.machine_id, sess.identity.region)
            )
            
        db_set_settings("active_uid", sess.identity.uid)
        
        add_log(f"Session saved from PAT. User: {account_name} ({sess.identity.uid})")
        _local_auth_error = None
        return {"ready": True, "id": sess.identity.uid, "name": account_name, "user_type": sess.identity.user_type}
    except Exception as exc:
        msg = f"Failed to authenticate with provided PAT: {exc}"
        add_log(msg, "ERROR")
        raise HTTPException(status_code=502, detail=msg) from exc


def is_quota_error(exc: Exception) -> bool:
    """判断是否为 quota/限流类错误（429 / quota / rate limit）。
    这类错误需先查询真实限额确认，不能直接跳过账户。"""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429
    if isinstance(exc, RuntimeError):
        msg = str(exc).lower()
        return any(k in msg for k in ("http 429", "quota", "rate limit", "insufficient"))
    return False


def is_account_error(exc: Exception) -> bool:
    """判断是否'账号级'错误（token 无效/限额/服务端拒绝）。只有这类才应跳过账户。

    网络/流中断/超时（如 httpx.ReadError 的 incomplete chunk read）是临时性问题，
    换账户也无效，不应触发 rotate。
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (401, 403, 429)
    if isinstance(exc, httpx.HTTPError):
        return False  # 连接/超时/读错误等网络问题
    if isinstance(exc, RuntimeError):
        msg = str(exc).lower()
        if any(code in msg for code in ("http 401", "http 403", "http 429")):
            return True
        for kw in ("unauthorized", "invalid token", "quota", "rate limit",
                   "insufficient", "personal token", "credit"):
            if kw in msg:
                return True
    return False


@app.get("/v1/models")
async def list_models():
    models_list = [
        {"id": "kimi-k3", "owned_by": "qoder"},
        {"id": "deepseek-v4-pro", "owned_by": "qoder"},
        {"id": "qwen-3.8-max", "owned_by": "qoder"},
        {"id": "glm-5.3", "owned_by": "qoder"},
        {"id": "kimi-k2.8", "owned_by": "qoder"},
        {"id": "deepseek-flash", "owned_by": "qoder"},
        {"id": "qwen-3.8-flash", "owned_by": "qoder"},
        {"id": "qwen-3.7-max", "owned_by": "qoder"},
        {"id": "qwen-3.7-plus", "owned_by": "qoder"},
        {"id": "qwen-3.7-flash", "owned_by": "qoder"},
        {"id": "glm-5.3-flash", "owned_by": "qoder"},
        {"id": "glm-5.2", "owned_by": "qoder"},
        {"id": "auto", "owned_by": "getit"},
        {"id": "lite", "owned_by": "getit"},
        # ZCode / BigModel models
        {"id": "glm-4-flash", "owned_by": "zcode"},
        {"id": "glm-4", "owned_by": "zcode"},
        {"id": "glm-4-plus", "owned_by": "zcode"},
        {"id": "glm-4-air", "owned_by": "zcode"},
        {"id": "glm-4-long", "owned_by": "zcode"},
        {"id": "codegeex-4", "owned_by": "zcode"},
        # Universal aliases
        {"id": "claude-3-5-sonnet", "owned_by": "getit"},
        {"id": "gpt-4o", "owned_by": "getit"},
        {"id": "deepseek-v3", "owned_by": "getit"},
        {"id": "deepseek-r1", "owned_by": "getit"},
    ]
    return {
        "object": "list",
        "data": [{"id": m["id"], "object": "model", "created": 1789700000, "owned_by": m["owned_by"]} for m in models_list],
    }


@app.post("/v1/chat/completions")
async def chat_completions(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    x_account: str | None = Header(default=None, alias="X-Account"),
    x_account_uid: str | None = Header(default=None, alias="X-Account-UID"),
):
    config = load_config()
    from .config import parse_account_uids

    incoming_key = None
    bound_accounts: list[str] = []
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        incoming_key = authorization[len("Bearer ") :].strip()
        with get_db() as conn:
            k_row = conn.execute("SELECT account_uid FROM allowed_keys WHERE api_key = ?", (incoming_key,)).fetchone()
            if k_row and k_row["account_uid"]:
                bound_accounts = parse_account_uids(k_row["account_uid"])

    if config.get("auth_required", False):
        allowed_keys = config.get("allowed_keys", [])
        if not incoming_key or incoming_key not in allowed_keys:
            add_log("Access denied: Invalid or missing API Key in request header.", "WARNING")
            raise HTTPException(status_code=401, detail="Invalid or missing API Key")

    raw_model = str(payload.get("model") or "lite")
    model_target = None
    if "@" in raw_model:
        actual_model, acc_spec = raw_model.rsplit("@", 1)
        acc_spec = acc_spec.strip()
        if acc_spec.lower() not in ("all", "default", ""):
            model_target = acc_spec
        payload["model"] = actual_model.strip()
        model = payload["model"]
    else:
        model = raw_model

    import urllib.parse

    raw_header_val = (x_account_uid if isinstance(x_account_uid, str) else None) or (x_account if isinstance(x_account, str) else None)
    raw_header_target = (raw_header_val or "").strip() or None
    header_target = urllib.parse.unquote(raw_header_target) if raw_header_target else None

    # Priority: model suffix > header target > key bound accounts (single or list)
    if model_target:
        target_account: str | list[str] | None = model_target
    elif header_target:
        target_account = header_target
    elif len(bound_accounts) == 1:
        target_account = bound_accounts[0]
    elif len(bound_accounts) > 1:
        target_account = bound_accounts
    else:
        target_account = None

    # Determine preferred provider
    preferred_provider = None
    if isinstance(target_account, str) and target_account.lower() in ("zcode", "qoder", "custom"):
        preferred_provider = target_account.lower()
        target_account = None
    elif model.startswith(("glm-", "codegeex-", "zcode/")):
        preferred_provider = "zcode"

    stream = bool(payload.get("stream", False))
    messages_count = len(payload.get("messages", []))

    accounts_data = db_load_accounts()
    if isinstance(target_account, list):
        add_log(f"Incoming completion request (SUBSET POOL of {len(target_account)} accounts): model={model}, stream={stream}, messages={messages_count}")
        max_retries = max(1, len(target_account))
    elif isinstance(target_account, str):
        add_log(f"Incoming completion request (TARGETED -> '{target_account}'): model={model}, stream={stream}, messages={messages_count}")
        max_retries = 1
    else:
        add_log(f"Incoming completion request (DEFAULT POOL): model={model}, stream={stream}, messages={messages_count}")
        eligible_count = sum(1 for acc in accounts_data["accounts"] if acc.get("enabled", True) and acc.get("api_mode") == "all")
        if eligible_count == 0:
            raise HTTPException(
                status_code=503,
                detail="当前没有已开启【全部调用】的公共账号。请在账号池中将至少一个账号设为【全部调用】。",
            )
        max_retries = max(1, eligible_count)

    for attempt in range(max_retries):
        try:
            acc_record = get_active_account_record(target_account=target_account, preferred_provider=preferred_provider)
            provider = acc_record.get("provider") or "qoder"
            current_uid = acc_record["uid"]
            add_log(f"Request routing via [{provider.upper()}] account: {acc_record['name']} ({current_uid}) [Attempt {attempt+1}/{max_retries}]")

            if provider in ("zcode", "custom"):
                token = acc_record["security_oauth_token"]
                base_url = acc_record.get("base_url") or None
                if stream:
                    gen = forward_zcode_stream(payload, api_key=token, base_url=base_url)
                    add_log(f"Streaming response initiated via {provider.upper()}.")
                    return StreamingResponse(
                        gen,
                        media_type="text/event-stream",
                        headers={"Cache-Control": "no-cache"},
                    )
                else:
                    add_log(f"Generating completion response via {provider.upper()}...")
                    resp = await forward_zcode_complete(payload, api_key=token, base_url=base_url)
                    add_log("Completion request finished successfully.")
                    return resp

            # Otherwise provider is qoder
            sess = await get_session(target_account=acc_record["uid"])
            if stream:
                gen = stream_openai_response(payload, sess)
                try:
                    first_item = await gen.__anext__()
                except StopAsyncIteration:
                    first_item = None

                async def stream_success_wrapper(first, g):
                    if first is not None:
                        yield first
                    async for chunk in g:
                        yield chunk

                add_log(f"Streaming response initiated (Attempt {attempt+1}/{max_retries}).")
                return StreamingResponse(
                    stream_success_wrapper(first_item, gen),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache"},
                )
            else:
                add_log(f"Generating full completion response (Attempt {attempt+1}/{max_retries})...")
                resp = await complete_openai_response(payload, sess)
                add_log("Completion request finished successfully.")
                return resp
        except Exception as exc:
            current_uid = locals().get("current_uid", "unknown")
            if isinstance(target_account, str):
                add_log(f"Targeted request to '{target_account}' failed: {exc}", "ERROR")
                raise HTTPException(status_code=502, detail=f"指定账号【{target_account}】调用失败: {exc}")

            if is_account_error(exc):
                if is_quota_error(exc):
                    # quota 类错误：先发一次请求确认是否真正 exceeded，而不是直接跳过
                    q = get_account_quota(current_uid)
                    if q.get("ok"):
                        quota = q["quota"]
                        uq = quota.get("userQuota") or {}
                        addon = quota.get("addOnQuota") or {}
                        org_pkg = quota.get("orgResourcePackage") or {}
                        total_remaining = float(uq.get("remaining", 0.0)) + float(addon.get("remaining", 0.0)) + float(org_pkg.get("remaining", 0.0))
                        truly_exceeded = bool(quota.get("isQuotaExceeded")) or total_remaining <= 0
                        if not truly_exceeded:
                            add_log(f"Quota check on {current_uid}: NOT exceeded (remaining={total_remaining}), not rotating.", "WARNING")
                            raise HTTPException(status_code=502, detail=f"{exc}")
                        add_log(f"Quota confirmed exceeded for {current_uid}: {exc}. Rotating...", "WARNING")
                    else:
                        # 限额查询失败：无法确认，保守不跳过账户
                        add_log(f"Quota check failed for {current_uid} ({q.get('error')}), not rotating.", "WARNING")
                        raise HTTPException(status_code=502, detail=f"{exc}")
                else:
                    add_log(f"Account-level error on {current_uid}: {exc}. Rotating to next account...", "WARNING")
                try:
                    rotate_next_account(current_uid, str(exc), target_account=None)
                except Exception as e:
                    add_log(f"Failed to rotate account: {e}", "ERROR")
                    raise HTTPException(status_code=502, detail=f"Request failed and no other account is available. Error: {exc}")
            else:
                add_log(f"Transient error on account {current_uid}: {exc}. Not rotating account.", "WARNING")
                raise HTTPException(status_code=502, detail=str(exc))
                
    raise HTTPException(status_code=502, detail="Request failed on all available accounts.")


@app.post("/v1/responses")
async def responses_api(payload: dict[str, Any], authorization: str | None = Header(default=None)):
    if "messages" not in payload and "input" in payload:
        inp = payload["input"]
        if isinstance(inp, str):
            payload["messages"] = [{"role": "user", "content": inp}]
        elif isinstance(inp, list):
            payload["messages"] = inp
    return await chat_completions(payload, authorization)


def main() -> None:
    import uvicorn

    start_refresh_loop()  # 启动 token 定时刷新线程（每 6 小时）
    start_checkin_loop()  # 启动每日自动签到线程（每天 00:05 + 启动补签）

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("QODER_HOST") or os.getenv("HOST") or "0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.getenv("QODER_PORT") or os.getenv("PORT") or "5050"))
    args = parser.parse_args()
    uvicorn.run("qoder2api.app:app", host=args.host, port=args.port, reload=False)

if __name__ == "__main__":
    main()
