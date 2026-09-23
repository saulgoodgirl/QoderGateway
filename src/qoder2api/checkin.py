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

# 记录最后自动执行签到的周期字符串 (YYYY-MM-DD，以 10:00 UTC+8 为锚点)
_last_auto_checkin_cycle: str | None = None
_checkin_thread: threading.Thread | None = None
_checkin_lock = threading.Lock()


def get_current_checkin_cycle() -> str:
    """获取当前签到周期标识（以每日 10:00:00 UTC+8 为界）。
    例如：
    09-23 09:30 -> 属于 2026-09-22 周期（昨天 10:00 到今天 10:00）
    09-23 10:00 -> 属于 2026-09-23 周期（今天 10:00 到明天 10:00）
    """
    now_sh = datetime.now(TZ_SHANGHAI)
    if now_sh.hour < 10:
        cycle_dt = now_sh - timedelta(days=1)
    else:
        cycle_dt = now_sh
    return cycle_dt.strftime("%Y-%m-%d")


def get_seconds_until_next_refresh() -> int:
    """计算距离下一个 10:00:00 (UTC+8) 官方刷新时刻的剩余秒数。"""
    now_sh = datetime.now(TZ_SHANGHAI)
    if now_sh.hour < 10:
        target = now_sh.replace(hour=10, minute=0, second=0, microsecond=0)
    else:
        target = (now_sh + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    return max(0, int((target - now_sh).total_seconds()))


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


def claim_checkin(uid: str, force: bool = False) -> dict[str, Any]:
    """为单个账号执行每日签到领取 100 Credits。"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE uid = ?", (uid,)).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}

    now_sh = datetime.now(TZ_SHANGHAI)
    if now_sh.hour < 10 and not force:
        rem_sec = get_seconds_until_next_refresh()
        h = rem_sec // 3600
        m = (rem_sec % 3600) // 60
        s = rem_sec % 60
        return {
            "ok": True,
            "claimed": False,
            "already_claimed": False,
            "waiting_refresh": True,
            "credits": 0,
            "uid": uid,
            "name": row["name"],
            "message": f"今日签到尚未开放（每日 10:00 刷新，倒计时 {h:02d}:{m:02d}:{s:02d}），请等待 10:00 自动入账",
        }

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
            current_cycle = get_current_checkin_cycle()
            try:
                with get_db() as conn:
                    conn.execute("UPDATE accounts SET last_checkin_cycle = ? WHERE uid = ?", (current_cycle, uid))
            except Exception:
                pass
            return {
                "ok": True,
                "claimed": True,
                "already_claimed": False,
                "waiting_refresh": False,
                "credits": reward,
                "uid": uid,
                "name": row["name"],
                "message": f"签到成功！获得 +{reward} Credits",
                "raw": data,
            }

        if r.status_code == 409:
            # 已经签过到了
            current_cycle = get_current_checkin_cycle()
            try:
                with get_db() as conn:
                    conn.execute("UPDATE accounts SET last_checkin_cycle = ? WHERE uid = ?", (current_cycle, uid))
            except Exception:
                pass
            return {
                "ok": True,
                "claimed": False,
                "already_claimed": True,
                "waiting_refresh": False,
                "credits": 0,
                "uid": uid,
                "name": row["name"],
                "message": "今日已签到（奖励已领取）",
            }

        return {
            "ok": False,
            "claimed": False,
            "already_claimed": False,
            "waiting_refresh": False,
            "uid": uid,
            "name": row["name"],
            "error": f"HTTP {r.status_code}: {r.text[:160]}",
        }

    return {"ok": False, "uid": uid, "name": row["name"], "error": "未知错误重试耗尽"}


def checkin_all_accounts(force: bool = False) -> dict[str, Any]:
    """为数据库中所有启用的账号执行签到。"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT uid, name FROM accounts WHERE enabled = 1"
        ).fetchall()

    now_sh = datetime.now(TZ_SHANGHAI)
    if now_sh.hour < 10 and not force:
        rem_sec = get_seconds_until_next_refresh()
        h = rem_sec // 3600
        m = (rem_sec % 3600) // 60
        s = rem_sec % 60
        return {
            "total": len(rows),
            "claimed": 0,
            "already_claimed": 0,
            "failed": 0,
            "waiting_refresh": True,
            "total_credits": 0,
            "message": f"今日签到尚未开放（每日 10:00 刷新，倒计时 {h:02d}:{m:02d}:{s:02d}），请等待 10:00 自动执行入账",
            "results": [],
        }

    results = []
    claimed_count = 0
    already_count = 0
    failed_count = 0
    total_credits = 0

    for r in rows:
        res = claim_checkin(r["uid"], force=force)
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

    now_sh = datetime.now(TZ_SHANGHAI)
    is_before_10am = (now_sh.hour < 10)
    current_cycle = get_current_checkin_cycle()
    next_refresh_seconds = get_seconds_until_next_refresh()

    accounts_detail = []
    claimed_count = 0
    pending_count = 0
    waiting_count = 0
    total_credits_claimed_today = 0
    total_remaining_credits = 0.0

    for r in rows:
        uid = r["uid"]
        name = r["name"]
        # 从 quota_raw 或数据库动态识别是否为企业/团队版
        raw_u_type = str(r["user_type"] or "").lower()
        plan = str(r["plan"] or ("Teams" if "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type else "Personal"))
        is_enterprise = (plan == "Teams" or "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type)

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

                api_u_type = str(quota_raw.get("userType") or "").strip().lower()
                has_org = bool(org_pkg.get("available")) or float(org_pkg.get("remaining", 0.0)) > 0
                if "team" in api_u_type or "org" in api_u_type or "enterprise" in api_u_type or has_org:
                    is_enterprise = True
                    plan = "Teams"
                else:
                    is_enterprise = False
                    plan = "Personal"

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
        cl_err = None

        if is_before_10am:
            # 10:00 之前：今天的签到尚未开放，处于等待官方 10:00 刷新阶段
            status_code = "waiting_refresh"
            status_text = "待 10:00 刷新"
            waiting_count += 1
            is_claimed = False
        else:
            # 10:00 之后：今日已开放签到，进行幂等检查/补签
            cl = claim_checkin(uid)
            is_claimed = bool(cl.get("claimed") or cl.get("already_claimed"))
            if cl.get("claimed"):
                claimed_count += 1
                total_credits_claimed_today += cl.get("credits", 100)
                status_code = "claimed"
                status_text = "已签到 (+100)"
            elif cl.get("already_claimed"):
                claimed_count += 1
                status_code = "claimed"
                status_text = "已签到 (+100)"
            else:
                pending_count += 1
                status_code = "pending"
                status_text = "待签到"
            if not cl.get("ok"):
                cl_err = cl.get("error")

        accounts_detail.append({
            "uid": uid,
            "name": name,
            "user_type": "teams" if is_enterprise else "personal",
            "is_enterprise": is_enterprise,
            "plan": plan,
            "claimed_today": is_claimed,
            "status_code": status_code,
            "status_text": status_text,
            "reward_credits": st.get("reward_credits", 100) if st.get("ok") else 100,
            "streak_days": st.get("streak_days", 0) if st.get("ok") else 0,
            "total_claim_days": st.get("total_claim_days", 0) if st.get("ok") else 0,
            "quota_info": user_quota_info,
            "error": cl_err,
        })

    return {
        "total_accounts": len(rows),
        "claimed_count": claimed_count,
        "pending_count": pending_count,
        "waiting_count": waiting_count,
        "is_before_10am": is_before_10am,
        "total_credits_claimed_today": total_credits_claimed_today,
        "total_remaining_credits": round(total_remaining_credits, 1),
        "accounts": accounts_detail,
        "last_auto_date": _last_auto_checkin_cycle,
        "cycle_id": current_cycle,
        "next_refresh_seconds": next_refresh_seconds,
        "refresh_rule": "每日 10:00 (UTC+8) 刷新，领取后 30 天有效 + 100 Credits",
    }


# ---------------------------------------------------------------------------
# 后台自动定时签到循环（开机按需补签 + 每天 10:00:05 准时自动执行）
# ---------------------------------------------------------------------------
def _checkin_loop() -> None:
    global _last_auto_checkin_cycle
    # 开机后稍作延时（3秒）
    time.sleep(3)
    try:
        now_sh = datetime.now(TZ_SHANGHAI)
        current_cycle = get_current_checkin_cycle()
        # 若当前时间在上午 10:00 之后，执行一次开机补签以防服务离线期间漏领
        if now_sh.hour >= 10:
            logger.info(f"[Checkin Auto] Startup run: past 10:00 AM, checking cycle {current_cycle}...")
            res = checkin_all_accounts()
            _last_auto_checkin_cycle = current_cycle
            logger.info(
                f"[Checkin Auto] Startup run finished: claimed={res['claimed']}, already={res['already_claimed']}, failed={res['failed']}"
            )
        else:
            remaining_secs = get_seconds_until_next_refresh()
            hours = remaining_secs // 3600
            mins = (remaining_secs % 3600) // 60
            secs = remaining_secs % 60
            logger.info(
                f"[Checkin Auto] Startup initialized: current time before 10:00 AM. Next official refresh in {hours:02d}:{mins:02d}:{secs:02d} (at 10:00:05 UTC+8)."
            )
    except Exception as e:
        logger.error(f"[Checkin Auto] Startup checkin failed: {e}")

    # 循环检测：每 20 秒检查一次是否到达 10:00:00 (UTC+8) 刷新分界点
    while True:
        try:
            time.sleep(20)
            now_sh = datetime.now(TZ_SHANGHAI)
            current_cycle = get_current_checkin_cycle()
            # 当天当前周期尚未自动执行，且当前时间在 10:00 之后
            if now_sh.hour >= 10 and _last_auto_checkin_cycle != current_cycle:
                logger.info(f"[Checkin Auto] Triggering daily 10:00:00 (UTC+8) auto-checkin for cycle: {current_cycle}")
                res = checkin_all_accounts()
                _last_auto_checkin_cycle = current_cycle
                logger.info(
                    f"[Checkin Auto] Finished: claimed={res['claimed']}, already={res['already_claimed']}, "
                    f"failed={res['failed']}, +{res.get('total_credits', 0)} Credits"
                )
        except Exception as e:
            logger.error(f"[Checkin Auto] Loop exception: {e}")
            time.sleep(30)


def start_checkin_loop() -> None:
    """启动后台每日自动签到线程（幂等）。"""
    global _checkin_thread
    with _checkin_lock:
        if _checkin_thread is None or not _checkin_thread.is_alive():
            _checkin_thread = threading.Thread(target=_checkin_loop, daemon=True, name="qoder-auto-checkin")
            _checkin_thread.start()
