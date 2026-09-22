import argparse
import collections
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import HTMLResponse, StreamingResponse
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

BASE_DIR = os.path.dirname(__file__)
INDEX_HTML = Path(BASE_DIR) / "static" / "index.html"
CONSOLE_HTML = Path(BASE_DIR) / "static" / "console.html"
DOCS_HTML = Path(BASE_DIR) / "static" / "docs.html"

app = FastAPI(title="qoder2api-python")
app.mount("/assets", StaticFiles(directory=os.path.join(BASE_DIR, "static", "assets")), name="assets")


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
    try:
        await get_session()
    except Exception:
        pass

    data = db_load_accounts()
    active_uid = data.get("active_uid")
    active_acc = None
    for acc in data["accounts"]:
        if acc["uid"] == active_uid:
            active_acc = acc
            break

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
async def checkin_status_endpoint(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """获取所有启用账号的每日签到状态与算力统计概览。"""
    try:
        return get_all_accounts_checkin_overview()
    except Exception as exc:
        add_log(f"Checkin status query error: {exc}", "ERROR")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/ui/checkin/claim")
async def checkin_claim_endpoint(payload: dict[str, Any] | None = None, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """执行每日签到。传入 {"uid": "..."} 签到单个账号，否则签到全部 enabled 账号。"""
    payload = payload or {}
    uid = payload.get("uid")
    if uid:
        res = claim_checkin(uid)
        msg = res.get("message") or res.get("error")
        add_log(f"Manual check-in for {res.get('name', uid)}: {msg}")
        return {"status": "ok", "result": res}

    res = checkin_all_accounts()
    add_log(
        f"Manual check-in all: claimed={res['claimed']}, already={res['already_claimed']}, "
        f"failed={res['failed']}, credits=+{res['total_credits']}"
    )
    return {"status": "ok", **res}


@app.post("/ui/registrar/start")
async def registrar_start(payload: dict[str, Any] | None = None, verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """启动注册机（无限循环：parents 个母线程 × 每批 3 个子任务，直到调用 stop）。

    body 可选：{"parents": 2}  —— 母线程数（1-6），每母线程 3 子任务并发。
    """
    payload = payload or {}
    try:
        parents = int(payload.get("parents", 2))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="parents 参数无效")
    return start_registration(parents=parents)


@app.post("/ui/registrar/stop")
async def registrar_stop(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """请求停止：当前批次完成后停止，返回本次注册统计。"""
    return stop_registration()


@app.get("/ui/registrar/status")
async def registrar_status(verify: None = Depends(check_gateway_token)) -> dict[str, Any]:
    """查询注册机任务状态（stage / logs / result）。"""
    return get_registrar_status()


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
        "qmodel_38max", "qwen-3.8-max",
        "qfmodel", "qwen-3.8-flash",
        "qmodel_latest", "qwen-3.7-max",
        "qmodel", "qwen-3.7-plus",
        "q37fmodel", "qwen-3.7-flash",
        "dmodel", "deepseek-v4-pro",
        "dfmodel", "deepseek-flash",
        "gmodel", "glm-5.3",
        "gfmodel", "glm-5.3-flash",
        "gm51model", "glm-5.2",
        "kmodel_latest", "kimi-k3",
        "kmodel", "kimi-k2.8",
        "mmodel", "minimax-m2.7",
        "auto", "lite",
    ]
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "created": 1789700000, "owned_by": "qoder"} for m in models_list]
    }


@app.post("/v1/chat/completions")
async def chat_completions(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    x_account: str | None = Header(default=None, alias="X-Account"),
    x_account_uid: str | None = Header(default=None, alias="X-Account-UID"),
):
    config = load_config()
    incoming_key = None
    bound_account = None
    if authorization and authorization.startswith("Bearer "):
        incoming_key = authorization[len("Bearer "):].strip()
        with get_db() as conn:
            k_row = conn.execute("SELECT account_uid FROM allowed_keys WHERE api_key = ?", (incoming_key,)).fetchone()
            if k_row and k_row["account_uid"]:
                bound_account = str(k_row["account_uid"]).strip()

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

    header_target = (x_account_uid or x_account or "").strip() or None
    target_account = bound_account or header_target or model_target or None

    stream = bool(payload.get("stream", False))
    messages_count = len(payload.get("messages", []))
    
    accounts_data = db_load_accounts()
    if target_account:
        add_log(f"Incoming completion request (TARGETED -> '{target_account}'): model={model}, stream={stream}, messages={messages_count}")
        max_retries = 1
    else:
        add_log(f"Incoming completion request (DEFAULT POOL): model={model}, stream={stream}, messages={messages_count}")
        eligible_count = sum(1 for acc in accounts_data["accounts"] if acc.get("enabled", True) and acc.get("api_mode") == "all")
        if eligible_count == 0:
            raise HTTPException(
                status_code=503,
                detail="当前没有已开启【全部调用】的公共账号。请在账号池中将至少一个账号设为【全部调用】。"
            )
        max_retries = max(1, eligible_count)
    
    for attempt in range(max_retries):
        try:
            sess = await get_session(target_account=target_account)
            add_log(f"Request routing via account: {sess.identity.name} ({sess.identity.uid}) [Attempt {attempt+1}/{max_retries}]")
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
                    headers={"Cache-Control": "no-cache"}
                )
            else:
                add_log(f"Generating full completion response (Attempt {attempt+1}/{max_retries})...")
                resp = await complete_openai_response(payload, sess)
                add_log("Completion request finished successfully.")
                return resp
        except Exception as exc:
            current_uid = sess.identity.uid if 'sess' in locals() else "unknown"
            if target_account:
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
