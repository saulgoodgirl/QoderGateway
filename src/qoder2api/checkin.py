"""
Qoder 每日签到与活动权益模块 (Daily Campaigns & Benefits Claim)

- 官方活动权益体系 (Desktop Client 10):
  - 权益状态查询: GET https://openapi.qoder.com.cn/sash/api/v1/me/campaigns
  - 权益福利领取: POST https://openapi.qoder.com.cn/sash/api/v1/me/campaigns/{campaign_id}/claim
- 机制:
  - 官方每日 10:00 (UTC+8) 刷新每日福利活动 (如 act-YYYYMMDD-xxx)
  - 成功领取官方即刻入账 +100 Credits 资源包 (30天有效)
  - 采用 Desktop Client 请求头 (Cosy-ClientType: 10, Cosy-Version: 0.2.5, User-Agent: Qoder)
  - 自动识别个人版 (参与每日签到) vs 企业/团队版 (免签，共享企业算力池)
  - 后台自动守护线程：开机自动补领，每日 10:00:05 准时自动执行全账号入账
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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

# 签到概览内存缓存（30 秒 TTL，避免频繁打满上游 HTTP）
_checkin_cache_lock = threading.Lock()
_cached_overview: dict[str, Any] | None = None
_cached_overview_time: float = 0.0


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def invalidate_checkin_cache() -> None:
    """清理签到概览缓存，强制下次重新计算。"""
    global _cached_overview, _cached_overview_time
    with _checkin_cache_lock:
        _cached_overview = None
        _cached_overview_time = 0.0


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


def _headers(token: str, client_type: str = "10") -> dict[str, str]:
    """生成请求头。
    使用官方桌面客户端凭证标识 Cosy-ClientType: 10，方能正常获取与领取官方活动权益。
    """
    if str(client_type) == "10":
        return {
            "Authorization": f"Bearer {token.strip()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Qoder",
            "Cosy-Version": "0.2.5",
            "Cosy-ClientType": "10",
        }
    return {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": UA,
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }


def get_checkin_status(uid: str) -> dict[str, Any]:
    """查询单个账号的今日活动签到状态与连续签到天数。
    对接 Qoder 官方最新 Campaigns 体系 (Cosy-ClientType: 10)。
    """
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE uid = ?", (uid,)).fetchone()
    if not row:
        return {"ok": False, "uid": uid, "error": "账号不存在"}

    token = (row["security_oauth_token"] or "").strip()
    if not token:
        return {"ok": False, "uid": uid, "error": "无可用 Token"}

    region = row["region"] if "region" in row.keys() else "cn"
    base_api = get_openapi_url(region)
    url = f"{base_api}/sash/api/v1/me/campaigns"

    for attempt in range(2):
        try:
            r = httpx.get(url, headers=_headers(token, client_type="10"), timeout=20)
        except httpx.HTTPError as e:
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"网络错误: {e}"}

        if r.status_code == 401 and attempt == 0:
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
        campaigns = data.get("campaigns") or []
        show_campaign = bool(data.get("showCampaign"))
        claimable_global = bool(data.get("claimable"))

        # 查找包含算力领取的活动 (如 act-20260923-076, benefit.amount=100)
        active_camp = None
        for c in campaigns:
            if c.get("actionType") == "CLAIM_BENEFIT":
                active_camp = c
                break

        current_cycle = get_current_checkin_cycle()
        prev_cycle = row["last_checkin_cycle"] if "last_checkin_cycle" in row.keys() else None
        local_streak = int(row["checkin_streak"] if "checkin_streak" in row.keys() and row["checkin_streak"] else 1)
        local_total = int(row["total_claim_days"] if "total_claim_days" in row.keys() and row["total_claim_days"] else 1)

        raw_u_type = str(row["user_type"] or "").lower()
        is_ent = "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type

        if not active_camp:
            return {
                "ok": True,
                "uid": uid,
                "name": row["name"],
                "has_campaign": False,
                "is_enterprise": is_ent,
                "claimable": False,
                "claimed": is_ent,  # 企业版标记免签
                "reward_credits": 0,
                "streak_days": local_streak if prev_cycle == current_cycle else 0,
                "total_claim_days": local_total,
                "raw": data,
            }

        c_status = active_camp.get("claimStatus", "UNKNOWN")
        is_claimable = (c_status == "CLAIMABLE" or claimable_global)
        is_claimed = (c_status == "CLAIMED")
        benefit = active_camp.get("benefit") or {}
        reward_credits = benefit.get("amount", 100)

        # 只要官方已经 CLAIMED 或本地记录今日已签，连续签到保底至少 1 天
        if is_claimed or prev_cycle == current_cycle:
            display_streak = max(1, local_streak)
            display_total = max(1, local_total)
        else:
            yesterday_cycle = (datetime.now(TZ_SHANGHAI) - timedelta(days=1)).strftime("%Y-%m-%d")
            display_streak = local_streak if prev_cycle == yesterday_cycle else 0
            display_total = local_total

        return {
            "ok": True,
            "uid": uid,
            "name": row["name"],
            "has_campaign": True,
            "is_enterprise": False,
            "campaign_id": active_camp.get("campaignId"),
            "campaign_key": active_camp.get("campaignKey"),
            "claim_status": c_status,
            "claimable": is_claimable,
            "claimed": is_claimed,
            "reward_credits": reward_credits,
            "streak_days": display_streak,
            "total_claim_days": display_total,
            "raw": active_camp,
        }

    return {"ok": False, "uid": uid, "name": row["name"], "error": "未知状态重试耗尽"}


def claim_checkin(uid: str, force: bool = False) -> dict[str, Any]:
    """为单个账号执行每日签到领取 100 Credits。
    优先调用官方真实活动权益接口: POST /sash/api/v1/me/campaigns/{campaign_id}/claim
    """
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
    campaigns_url = f"{base_api}/sash/api/v1/me/campaigns"

    current_cycle = get_current_checkin_cycle()
    prev_cycle = row["last_checkin_cycle"] if "last_checkin_cycle" in row.keys() else None
    yesterday_cycle = (datetime.now(TZ_SHANGHAI) - timedelta(days=1)).strftime("%Y-%m-%d")
    old_streak = int(row["checkin_streak"] if "checkin_streak" in row.keys() and row["checkin_streak"] else 0)
    old_total = int(row["total_claim_days"] if "total_claim_days" in row.keys() and row["total_claim_days"] else 0)

    if prev_cycle == current_cycle:
        new_streak = max(1, old_streak)
        new_total = max(1, old_total)
    elif prev_cycle == yesterday_cycle:
        new_streak = old_streak + 1
        new_total = old_total + 1
    else:
        new_streak = 1
        new_total = max(1, old_total + 1)

    # 1. 尝试通过 Campaigns 权益体系领取
    for attempt in range(2):
        try:
            r = httpx.get(campaigns_url, headers=_headers(token, client_type="10"), timeout=20)
        except httpx.HTTPError as e:
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"网络错误: {e}"}

        if r.status_code == 401 and attempt == 0:
            ref = refresh_one_account(uid)
            if ref.get("ok"):
                with get_db() as conn:
                    updated = conn.execute("SELECT security_oauth_token FROM accounts WHERE uid = ?", (uid,)).fetchone()
                    token = updated["security_oauth_token"]
                continue
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"Token 过期且刷新失败: {ref.get('error')}"}

        if r.status_code != 200:
            return {"ok": False, "uid": uid, "name": row["name"], "error": f"HTTP {r.status_code}: {r.text[:160]}"}

        camp_data = r.json()
        campaigns = camp_data.get("campaigns") or []

        claim_targets = []
        already_claimed_targets = []
        for c in campaigns:
            if c.get("actionType") == "CLAIM_BENEFIT":
                c_id = c.get("campaignId")
                c_status = c.get("claimStatus")
                if (c_status == "CLAIMABLE" or camp_data.get("claimable")) and c_id:
                    claim_targets.append(c)
                elif c_status == "CLAIMED":
                    already_claimed_targets.append(c)

        if not claim_targets and already_claimed_targets:
            # 已经全部领取了
            try:
                with get_db() as conn:
                    conn.execute(
                        "UPDATE accounts SET last_checkin_cycle = ?, checkin_streak = ?, total_claim_days = ? WHERE uid = ?",
                        (current_cycle, new_streak, new_total, uid)
                    )
            except Exception:
                pass
            invalidate_checkin_cache()
            return {
                "ok": True,
                "claimed": False,
                "already_claimed": True,
                "waiting_refresh": False,
                "credits": 0,
                "uid": uid,
                "name": row["name"],
                "streak_days": new_streak,
                "message": "今日签到福利已领取 (+100 Credits 已在账户中)",
            }

        if claim_targets:
            total_gained = 0
            for ct in claim_targets:
                cid = ct["campaignId"]
                claim_api_url = f"{base_api}/sash/api/v1/me/campaigns/{cid}/claim"
                try:
                    c_res = httpx.post(claim_api_url, headers=_headers(token, client_type="10"), json={}, timeout=20)
                    if c_res.status_code == 200:
                        c_data = c_res.json()
                        amt = c_data.get("benefit", {}).get("amount", 100)
                        total_gained += amt
                    elif c_res.status_code in (400, 409):
                        pass
                except Exception as e:
                    logger.warning(f"Error claiming campaign {cid} for {uid}: {e}")

            if total_gained > 0 or already_claimed_targets:
                try:
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE accounts SET last_checkin_cycle = ?, checkin_streak = ?, total_claim_days = ? WHERE uid = ?",
                            (current_cycle, new_streak, new_total, uid)
                        )
                except Exception:
                    pass
                invalidate_checkin_cache()
                return {
                    "ok": True,
                    "claimed": total_gained > 0,
                    "already_claimed": total_gained == 0,
                    "waiting_refresh": False,
                    "credits": total_gained if total_gained > 0 else 0,
                    "uid": uid,
                    "name": row["name"],
                    "streak_days": new_streak,
                    "message": f"签到成功！官方 +{total_gained} Credits 实时到账！" if total_gained > 0 else "今日签到福利已领取",
                }

        # 如果没有 campaigns (例如企业账号)
        raw_u_type = str(row["user_type"] or "").lower()
        is_ent = "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type
        return {
            "ok": True,
            "claimed": False,
            "already_claimed": is_ent,
            "waiting_refresh": False,
            "credits": 0,
            "uid": uid,
            "name": row["name"],
            "streak_days": new_streak if is_ent else 0,
            "message": "企业团队账号免签，共享组织资源池" if is_ent else "当前暂无可领取的官方活动",
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

    invalidate_checkin_cache()
    return {
        "total": len(rows),
        "claimed": claimed_count,
        "already_claimed": already_count,
        "failed": failed_count,
        "total_credits": total_credits,
        "results": results,
    }


def get_all_accounts_checkin_overview(force: bool = False) -> dict[str, Any]:
    """获取所有启用账号的签到概览、今日状态及配额积分（支持 30 秒内存缓存与线程池并发查询）。"""
    global _cached_overview, _cached_overview_time
    now_ts = time.time()

    # 1. 命中 30 秒缓存时直接毫秒级返回
    with _checkin_cache_lock:
        if not force and _cached_overview is not None and (now_ts - _cached_overview_time < 30.0):
            cached = dict(_cached_overview)
            cached["next_refresh_seconds"] = get_seconds_until_next_refresh()
            return cached

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM accounts WHERE enabled = 1").fetchall()

    now_sh = datetime.now(TZ_SHANGHAI)
    is_before_10am = (now_sh.hour < 10)
    current_cycle = get_current_checkin_cycle()
    next_refresh_seconds = get_seconds_until_next_refresh()

    def process_single_account(r: Any) -> dict[str, Any]:
        uid = r["uid"]
        name = r["name"]
        raw_u_type = str(r["user_type"] or "").lower()
        plan = str(r["plan"] or ("Teams" if "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type else "Personal"))
        is_enterprise = (plan == "Teams" or "team" in raw_u_type or "org" in raw_u_type or "enterprise" in raw_u_type)

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

                plan_rem = _safe_float(uq.get("remaining"))
                plan_total = _safe_float(uq.get("total"))
                plan_used = _safe_float(uq.get("used"))

                addon_rem = _safe_float(addon.get("remaining"))
                addon_total = _safe_float(addon.get("total"))
                addon_used = _safe_float(addon.get("used"))

                org_rem = _safe_float(org_pkg.get("remaining"))
                org_total_raw = _safe_float(org_pkg.get("total"))
                org_cap = _safe_float(org_pkg.get("cap"), -1.0)
                org_total = org_total_raw if org_total_raw > 0 else (org_cap if org_cap > 0 else org_rem)
                org_used = _safe_float(org_pkg.get("used"))

                rem_credits = plan_rem + addon_rem + org_rem
                used_credits = plan_used + addon_used + org_used
                tot_credits = plan_total + addon_total + org_total
                if tot_credits < rem_credits + used_credits:
                    tot_credits = rem_credits + used_credits

                if is_enterprise:
                    quota_desc = f"套餐 {plan_rem:,.0f} + 组织资源 {org_rem:,.0f} (企业版走团队资源池，官方无个人加油包)"
                elif addon_rem > 0 and plan_rem > 0:
                    quota_desc = f"基础套餐 {plan_rem:,.0f} + 签到加油包 {addon_rem:,.0f} Credits (30天有效)"
                elif addon_rem > 0:
                    quota_desc = f"累计签到加油包 {addon_rem:,.0f} Credits (30天有效)"
                else:
                    quota_desc = f"当前可用算力 {rem_credits:,.0f} Credits"

                user_quota_info = {
                    "remaining": rem_credits,
                    "total": tot_credits,
                    "used": used_credits,
                    "plan_remaining": plan_rem,
                    "addon_remaining": addon_rem,
                    "org_remaining": org_rem,
                    "desc": quota_desc,
                }
        except Exception as e:
            logger.warning(f"Error parsing quota usage for {uid}: {e}")

        # 检查活动签到状态
        st = get_checkin_status(uid)
        cl_err = None

        if is_before_10am:
            status_code = "waiting_refresh"
            status_text = "待 10:00 刷新"
            is_claimed = False
        elif is_enterprise or st.get("is_enterprise"):
            status_code = "claimed"
            status_text = "企业免签"
            is_claimed = True
        else:
            if st.get("claimable"):
                # 自动替用户领取入账，无需用户手动操作！
                cl = claim_checkin(uid)
                is_claimed = bool(cl.get("claimed") or cl.get("already_claimed"))
                status_code = "claimed" if is_claimed else "pending"
                status_text = "已签到 (+100)" if is_claimed else "待签到"
                if not cl.get("ok"):
                    cl_err = cl.get("error")
                # 若本次新入账 100，刷新额度展示
                if cl.get("claimed"):
                    try:
                        from .tokens import get_account_quota
                        q_res = get_account_quota(uid)
                        if q_res.get("ok"):
                            quota_raw = q_res.get("quota", {})
                            uq = quota_raw.get("userQuota") or {}
                            addon = quota_raw.get("addOnQuota") or {}
                            plan_rem = _safe_float(uq.get("remaining"))
                            addon_rem = _safe_float(addon.get("remaining"))
                            rem_credits = plan_rem + addon_rem
                            if user_quota_info:
                                user_quota_info["remaining"] = rem_credits
                                user_quota_info["addon_remaining"] = addon_rem
                                user_quota_info["desc"] = f"基础套餐 {plan_rem:,.0f} + 签到加油包 {addon_rem:,.0f} Credits (30天有效)" if plan_rem > 0 else f"累计签到加油包 {addon_rem:,.0f} Credits (30天有效)"
                    except Exception:
                        pass
            elif st.get("claimed"):
                status_code = "claimed"
                status_text = "已签到 (+100)"
                is_claimed = True
            else:
                status_code = "pending"
                status_text = "待签到"
                is_claimed = False

        # 连续签到与累计签到天数显示：只要今天已领，保底至少显示 1 天
        local_streak = int(r["checkin_streak"] if "checkin_streak" in r.keys() and r["checkin_streak"] else 1)
        local_total = int(r["total_claim_days"] if "total_claim_days" in r.keys() and r["total_claim_days"] else 1)
        display_streak = max(1, local_streak) if (is_claimed and not is_enterprise) else (0 if not is_claimed else local_streak)
        display_total = max(1, local_total) if (is_claimed and not is_enterprise) else (0 if not is_claimed else local_total)

        return {
            "uid": uid,
            "name": name,
            "user_type": "teams" if is_enterprise else "personal",
            "is_enterprise": is_enterprise,
            "plan": plan,
            "claimed_today": is_claimed,
            "status_code": status_code,
            "status_text": status_text,
            "reward_credits": st.get("reward_credits", 100) if st.get("ok") else 100,
            "streak_days": display_streak,
            "total_claim_days": display_total,
            "quota_info": user_quota_info,
            "quota_desc": user_quota_info.get("desc") if user_quota_info else ("企业版走组织资源池" if is_enterprise else "含每日签到福利"),
            "rem_credits": rem_credits,
            "error": cl_err,
        }

    # 2. 多账号并发查询，彻底消除串行累加等待
    if len(rows) > 0:
        with ThreadPoolExecutor(max_workers=min(len(rows), 8)) as executor:
            accounts_detail = list(executor.map(process_single_account, rows))
    else:
        accounts_detail = []

    claimed_count = sum(1 for a in accounts_detail if a["status_code"] == "claimed")
    pending_count = sum(1 for a in accounts_detail if a["status_code"] == "pending")
    waiting_count = sum(1 for a in accounts_detail if a["status_code"] == "waiting_refresh")
    personal_claimed_count = sum(1 for a in accounts_detail if a["status_code"] == "claimed" and not a["is_enterprise"])
    total_credits_claimed_today = personal_claimed_count * 100
    total_remaining_credits = round(sum(a.pop("rem_credits", 0.0) for a in accounts_detail), 1)

    result = {
        "total_accounts": len(rows),
        "claimed_count": claimed_count,
        "pending_count": pending_count,
        "waiting_count": waiting_count,
        "is_before_10am": is_before_10am,
        "total_credits_claimed_today": total_credits_claimed_today,
        "total_remaining_credits": total_remaining_credits,
        "accounts": accounts_detail,
        "last_auto_date": _last_auto_checkin_cycle,
        "cycle_id": current_cycle,
        "next_refresh_seconds": next_refresh_seconds,
        "refresh_rule": "每日 10:00 (UTC+8) 刷新，领取后 30 天有效 + 100 Credits",
    }

    with _checkin_cache_lock:
        _cached_overview = result
        _cached_overview_time = now_ts

    return result


# ---------------------------------------------------------------------------
# 后台自动定时签到循环（开机按需补签 + 每天 10:00:05 准时自动执行）
# ---------------------------------------------------------------------------
def _checkin_loop() -> None:
    global _last_auto_checkin_cycle
    time.sleep(3)
    try:
        now_sh = datetime.now(TZ_SHANGHAI)
        current_cycle = get_current_checkin_cycle()
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

    while True:
        try:
            time.sleep(20)
            now_sh = datetime.now(TZ_SHANGHAI)
            current_cycle = get_current_checkin_cycle()
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
