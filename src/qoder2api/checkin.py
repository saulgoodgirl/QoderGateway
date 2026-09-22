"""
Qoder 每日签到与积分中心模块 (Daily Check-in & Rewards)

- 接口:
  - 状态查询: GET https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/status
  - 领取奖励: POST https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim
- 机制:
  - 每次成功领取 100 Credits 算力
  - 若已领取返回 HTTP 409 AlreadyExists
  - 若 Token 过期返回 HTTP 401，自动刷新后重试
  - 后台守护线程：开机自动补签，每日 00:05 定时自动为所有启用账号签到
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from .database import get_db
from .tokens import get_openapi_url, refresh_one_account, UA

logger = logging.getLogger("qoder2api.checkin")

# 北京时间时区 (UTC+8)
TZ_SHANGHAI = timezone(timedelta(hours=8))

# 记录最后自动执行签到的日期字符串 (YYYY-MM-DD)
_last_auto_checkin_date: str | None = None
_checkin_thread: threading.Thread | None = None
_checkin_lock = threading.Lock()


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": UA,
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }


def get_checkin_status(uid: str) -> dict[str, Any]:
    """查询单个账号的今日签到状态与连续签到天数。"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE uid = ?", (uid,)).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}

    token = (row["security_oauth_token"] or "").strip()
    if not token:
        return {"ok": False, "uid": uid, "error": "无可用 Token"}

    region = row["region"] if "region" in row.keys() else "cn"
    base_api = get_openapi_url(region)
    url = f"{base_api}/sash/api/v1/me/daily-check-in/status"

    # 发起请求（支持 401 自动刷新并重试一次）
    for attempt in range(2):
        try:
            r = httpx.get(url, headers=_headers(token), timeout=20)
        except httpx.HTTPError as e:
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"网络错误: {e}"}

        if r.status_code == 401 and attempt == 0:
            # Token 过期，尝试刷新
            ref = refresh_one_account(uid)
            if ref.get("ok"):
                with get_db() as conn:
                    updated = conn.execute("SELECT security_oauth_token FROM accounts WHERE uid = ?", (uid,)).fetchone()
                    token = updated["security_oauth_token"]
                continue
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"Token 过期且刷新失败: {ref.get('error')}"}

        if r.status_code != 200:
            return {
                "ok": False,
                "uid": uid,
                "name": row["name"],
                "error": f"HTTP {r.status_code}: {r.text[:160]}",
            }

        data = r.json()
        status_val = data.get("status", "UNKNOWN")
        # 兼容：如果 status 为 DISABLED 但在今日可能已领，通过 claim 判断；
        # 正常字段：currentStreakDays, totalClaimDays, totalRewardCredits, rewardCredits
        return {
            "ok": True,
            "uid": uid,
            "name": row["name"],
            "status": status_val,
            "reward_credits": data.get("rewardCredits", 100),
            "streak_days": data.get("currentStreakDays", 0),
            "total_claim_days": data.get("totalClaimDays", 0),
            "total_reward_credits": data.get("totalRewardCredits", 0),
            "raw": data,
        }

    return {"ok": False, "uid": uid, "name": row["name"], "error": "未知状态重试耗尽"}


def claim_checkin(uid: str) -> dict[str, Any]:
    """为单个账号执行每日签到领取 100 Credits。"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE uid = ?", (uid,)).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}

    token = (row["security_oauth_token"] or "").strip()
    if not token:
        return {"ok": False, "uid": uid, "error": "无可用 Token"}

    region = row["region"] if "region" in row.keys() else "cn"
    base_api = get_openapi_url(region)
    url = f"{base_api}/sash/api/v1/me/daily-check-in/claim"

    for attempt in range(2):
        try:
            r = httpx.post(url, headers=_headers(token), json={}, timeout=20)
        except httpx.HTTPError as e:
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"网络错误: {e}"}

        if r.status_code == 401 and attempt == 0:
            # Token 过期，自动刷新
            ref = refresh_one_account(uid)
            if ref.get("ok"):
                with get_db() as conn:
                    updated = conn.execute("SELECT security_oauth_token FROM accounts WHERE uid = ?", (uid,)).fetchone()
                    token = updated["security_oauth_token"]
                continue
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"Token 过期且刷新失败: {ref.get('error')}"}

        if r.status_code == 200:
            data = r.json()
            reward = data.get("rewardCredits", 100)
            return {
                "ok": True,
                "claimed": True,
                "already_claimed": False,
                "credits": reward,
                "uid": uid,
                "name": row["name"],
                "message": f"签到成功！获得 +{reward} Credits",
                "raw": data,
            }

        if r.status_code == 409:
            # 已经签过到了
            return {
                "ok": True,
                "claimed": False,
                "already_claimed": True,
                "credits": 0,
                "uid": uid,
                "name": row["name"],
                "message": "今日已签到（奖励已领取）",
            }

        return {
            "ok": False,
            "claimed": False,
            "already_claimed": False,
            "uid": uid,
            "name": row["name"],
            "error": f"HTTP {r.status_code}: {r.text[:160]}",
        }

    return {"ok": False, "uid": uid, "name": row["name"], "error": "未知错误重试耗尽"}


def checkin_all_accounts() -> dict[str, Any]:
    """为数据库中所有启用的账号执行签到。"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT uid, name FROM accounts WHERE enabled = 1"
        ).fetchall()

    results = []
    claimed_count = 0
    already_count = 0
    failed_count = 0
    total_credits = 0

    for r in rows:
        res = claim_checkin(r["uid"])
        results.append(res)
        if res.get("claimed"):
            claimed_count += 1
            total_credits += res.get("credits", 100)
        elif res.get("already_claimed"):
            already_count += 1
        else:
            failed_count += 1

    return {
        "total": len(rows),
        "claimed": claimed_count,
        "already_claimed": already_count,
        "failed": failed_count,
        "total_credits": total_credits,
        "results": results,
    }


def get_all_accounts_checkin_overview() -> dict[str, Any]:
    """获取所有启用账号的签到概览、今日状态及配额积分。"""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM accounts WHERE enabled = 1").fetchall()

    accounts_detail = []
    claimed_count = 0
    pending_count = 0
    total_credits_claimed_today = 0
    total_remaining_credits = 0.0

    # 简单调用 status 或尝试轻量 claim 校验
    for r in rows:
        uid = r["uid"]
        name = r["name"]
        u_type = str(r["user_type"] or "")
        plan = r["plan"] or ("Personal" if "personal" in u_type.lower() else "Teams")

        # 1. 尝试获取配额积分
        user_quota_info = None
        rem_credits = 0.0
        tot_credits = 0.0
        used_credits = 0.0
        try:
            from .tokens import get_account_quota
            q_res = get_account_quota(uid)
            if q_res.get("ok"):
                quota_raw = q_res.get("quota", {})
                uq = quota_raw.get("userQuota") or {}
                addon = quota_raw.get("addOnQuota") or {}
                org_pkg = quota_raw.get("orgResourcePackage") or {}

                # 汇总剩余算力：套餐内 + 资源包(加油包) + 组织资源包
                rem_credits = float(uq.get("remaining", 0.0)) + float(addon.get("remaining", 0.0)) + float(org_pkg.get("remaining", 0.0))
                used_credits = float(uq.get("used", 0.0)) + float(addon.get("used", 0.0)) + float(org_pkg.get("used", 0.0))

                org_total = float(org_pkg.get("total", 0.0) or (org_pkg.get("cap", 0.0) if org_pkg.get("cap", -1) > 0 else org_pkg.get("remaining", 0.0)))
                tot_credits = float(uq.get("total", 0.0)) + float(addon.get("total", 0.0)) + org_total
                if tot_credits < rem_credits + used_credits:
                    tot_credits = rem_credits + used_credits

                user_quota_info = {
                    "remaining": rem_credits,
                    "total": tot_credits,
                    "used": used_credits,
                }
        except Exception:
            pass

        total_remaining_credits += rem_credits

        # 2. 查询签到状态
        st = get_checkin_status(uid)
        
        # 判断今日是否已签到：如果调用 claim 得到 409，说明已签到；如果 status 正常也说明已签到
        # 为最准确认定，做一次幂等轻量 claim 检查（已签到会返回 409 AlreadyExists，未签到直接顺带完成签到）
        cl = claim_checkin(uid)
        is_claimed = cl.get("claimed") or cl.get("already_claimed")
        if cl.get("claimed"):
            claimed_count += 1
            total_credits_claimed_today += cl.get("credits", 100)
        elif cl.get("already_claimed"):
            claimed_count += 1
        else:
            pending_count += 1

        accounts_detail.append({
            "uid": uid,
            "name": name,
            "plan": plan,
            "claimed_today": is_claimed,
            "status_text": "已签到 (+100)" if is_claimed else "未签到",
            "reward_credits": st.get("reward_credits", 100) if st.get("ok") else 100,
            "streak_days": st.get("streak_days", 0) if st.get("ok") else 0,
            "total_claim_days": st.get("total_claim_days", 0) if st.get("ok") else 0,
            "quota_info": user_quota_info,
            "error": cl.get("error") if not cl.get("ok") else None,
        })

    return {
        "total_accounts": len(rows),
        "claimed_count": claimed_count,
        "pending_count": pending_count,
        "total_credits_claimed_today": total_credits_claimed_today,
        "total_remaining_credits": round(total_remaining_credits, 1),
        "accounts": accounts_detail,
        "last_auto_date": _last_auto_checkin_date,
    }


# ---------------------------------------------------------------------------
# 后台自动定时签到循环（开机补签 + 每天 00:05 自动执行）
# ---------------------------------------------------------------------------
def _checkin_loop() -> None:
    global _last_auto_checkin_date
    # 开机后稍作延时（3秒），先执行一次开机补签
    time.sleep(3)
    try:
        now_sh = datetime.now(TZ_SHANGHAI)
        today_str = now_sh.strftime("%Y-%m-%d")
        res = checkin_all_accounts()
        _last_auto_checkin_date = today_str
        logger.info(
            f"[Checkin Auto] Startup run: claimed={res['claimed']}, already={res['already_claimed']}, failed={res['failed']}"
        )
    except Exception as e:
        logger.error(f"[Checkin Auto] Startup checkin failed: {e}")

    # 循环检测：每 60 秒检查一次，若跨天并且过了 00:05 则执行
    while True:
        try:
            time.sleep(60)
            now_sh = datetime.now(TZ_SHANGHAI)
            today_str = now_sh.strftime("%Y-%m-%d")
            # 当天尚未自动执行，且当前时间在 00:05 之后
            if _last_auto_checkin_date != today_str and (now_sh.hour > 0 or now_sh.minute >= 5):
                logger.info(f"[Checkin Auto] Triggering daily auto-checkin for date: {today_str}")
                res = checkin_all_accounts()
                _last_auto_checkin_date = today_str
                logger.info(
                    f"[Checkin Auto] Finished: claimed={res['claimed']}, already={res['already_claimed']}, failed={res['failed']}"
                )
        except Exception as e:
            logger.error(f"[Checkin Auto] Loop exception: {e}")
            time.sleep(60)


def start_checkin_loop() -> None:
    """启动后台每日自动签到线程（幂等）。"""
    global _checkin_thread
    with _checkin_lock:
        if _checkin_thread is None or not _checkin_thread.is_alive():
            _checkin_thread = threading.Thread(target=_checkin_loop, daemon=True, name="qoder-auto-checkin")
            _checkin_thread.start()
