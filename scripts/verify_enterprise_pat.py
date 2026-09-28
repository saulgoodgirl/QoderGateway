#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""企业版 PAT 独立验证脚本（Qoder CN VPC）

不启动网关、不写数据库，直接用网关同款代码路径验证一个企业 PAT 是否可用：
  1) 企业域名归一化与端点派生（qoder2api.enterprise）
  2) PAT -> jobToken 兑换 + userinfo（qoder2api.auth.create_session）
  3) 配额查询  GET {openapi}/api/v2/quota/usage
  4) 可选 --chat：向 {gateway} 发一条最小对话（老版 COSY SSE），验证对话链路

用法：
  python scripts/verify_enterprise_pat.py --domain <实例名或企业域名> [--pat <PAT>] [--chat] [--no-proxy]

  --domain   也可通过环境变量 QODER_ENTERPRISE_DOMAIN 提供（示例：acme.vpc.qoder.com.cn）
  --pat      缺省时隐藏交互输入；PAT 不回显、不落盘、不打印全文
  --chat     额外做一次最小对话调用（推荐最终验收时使用）
  --no-proxy 忽略 shell 的 HTTP(S)_PROXY 环境变量直连（代理干扰 TLS 时使用，如本地沙箱）

常见问题：
  - TLS 证书错误：多因出站代理未信任；请检查系统 CA 或 QODER_PROXY 配置
  - 连接超时：确认当前网络能直连企业域名（curl -sI {openapi}/api/v1/userinfo）

退出码：0 = 全部通过；1 = 任一必需环节失败（错误信息含具体 host / HTTP 状态）。
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import httpx  # noqa: E402

from qoder2api.auth import create_session  # noqa: E402
from qoder2api.bridge import stream_openai_response  # noqa: E402
from qoder2api.enterprise import enterprise_origins, normalize_vpc_domain  # noqa: E402
from qoder2api.env import httpx_client_kwargs  # noqa: E402


def _mask(value: str | None) -> str:
    value = str(value or "")
    return f"{value[:6]}…({len(value)} chars)" if value else "(无)"


def _headers(token: str | None = None) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "pi-provider-qoder",
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_quota(openapi: str, token: str, timeout: float) -> tuple[bool, str]:
    url = f"{openapi}/api/v2/quota/usage"
    try:
        with httpx.Client(timeout=timeout, **httpx_client_kwargs()) as client:
            resp = client.get(url, headers=_headers(token))
    except httpx.HTTPError as exc:
        return False, f"网络错误：{exc!r}（检查网络连通性与 QODER_PROXY/系统代理）"
    if resp.status_code != 200:
        return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    try:
        data = resp.json()
        user_q = data.get("userQuota") or {}
        addon = data.get("addOnQuota") or {}
        org = data.get("orgResourcePackage") or {}
        remaining = (
            float(user_q.get("remaining", 0) or 0)
            + float(addon.get("remaining", 0) or 0)
            + float(org.get("remaining", 0) or 0)
        )
        return True, (
            f"剩余额度 {remaining:g}（user={user_q.get('remaining')} "
            f"addon={addon.get('remaining')} org={org.get('remaining')}） "
            f"isQuotaExceeded={bool(data.get('isQuotaExceeded'))}"
        )
    except Exception:
        return True, f"HTTP 200（解析跳过）：{resp.text[:160]}"


async def chat_smoke(sess, model: str) -> tuple[bool, str]:
    req = {"model": model, "messages": [{"role": "user", "content": "请只回复两个字符：OK"}]}
    parts: list[str] = []
    try:
        async for chunk in stream_openai_response(req, sess):
            if not chunk.startswith("data:"):
                continue
            payload = chunk[5:].strip()
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
            except Exception:
                continue
            for choice in data.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    parts.append(str(delta["content"]))
            if len("".join(parts)) >= 2 or len(parts) > 300:
                break
    except Exception as exc:
        return False, f"对话请求失败：{exc}"
    text = "".join(parts).strip()
    if not text:
        return False, "上游未返回文本内容（模型无输出或被内容策略拦截）"
    return True, f"响应片段: {text[:80]!r}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Qoder CN 企业版 PAT 独立验证")
    parser.add_argument("--domain", default="", help="企业实例名或域名（如 acme 或 acme.vpc.qoder.com.cn）")
    parser.add_argument("--pat", default="", help="企业 PAT；缺省时隐藏输入")
    parser.add_argument("--chat", action="store_true", help="额外发送一条最小对话验证 gateway 链路")
    parser.add_argument("--model", default="lite", help="--chat 使用的模型（默认 lite）")
    parser.add_argument("--no-proxy", action="store_true", help="忽略 HTTP(S)_PROXY 直连（代理干扰 TLS 时使用）")
    parser.add_argument("--timeout", type=float, default=20.0, help="单次 HTTP 超时秒数（默认 20）")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.no_proxy:
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
            os.environ.pop(key, None)

    domain_input = (args.domain or os.getenv("QODER_ENTERPRISE_DOMAIN", "")).strip()
    if not domain_input:
        print("[FAIL] 缺少企业域名：--domain <域名> 或环境变量 QODER_ENTERPRISE_DOMAIN")
        return 1
    try:
        instance = normalize_vpc_domain(domain_input)
    except ValueError as exc:
        print(f"[FAIL] 企业域名无效：{exc}")
        return 1
    origins = enterprise_origins(instance)
    print(f"[OK] 域名解析：{domain_input} -> 实例名 {instance}")
    print(f"     openapi = {origins['openapi']}")
    print(f"     gateway = {origins['gateway']}")
    print(f"     portal  = {origins['portal']}")

    pat = (args.pat or getpass.getpass("企业 PAT（输入不回显）: ")).strip()
    if not pat:
        print("[FAIL] PAT 为空")
        return 1

    try:
        sess = asyncio.run(create_session(pat, instance))
    except Exception as exc:
        print(f"[FAIL] PAT 兑换失败：{exc}")
        return 1
    ident = sess.identity
    print("[OK] PAT 兑换成功（jobToken/exchange + userinfo）")
    print(f"     uid={ident.uid}  name={ident.name}  user_type={ident.user_type}")
    print(f"     token={_mask(ident.security_oauth_token)}  refresh_token={_mask(ident.refresh_token)}")
    if not ident.refresh_token:
        print("[WARN] 未返回 refresh_token：令牌过期后无法自动刷新")

    quota_ok, quota_msg = fetch_quota(origins["openapi"], ident.security_oauth_token, args.timeout)
    print(("[OK] " if quota_ok else "[WARN] ") + f"配额查询：{quota_msg}")

    if args.chat:
        chat_ok, chat_msg = asyncio.run(chat_smoke(sess, args.model))
        print(("[OK] " if chat_ok else "[FAIL] ") + f"对话验证：{chat_msg}")
        if not chat_ok:
            return 1
    else:
        print("[SKIP] 对话验证未执行（加 --chat 开启；对话经 {instance}-gateway host 的 COSY SSE）")

    print("\n结论：企业 PAT 可用。")
    if not args.chat:
        print("建议追加 --chat 完成端到端验证（兑换 -> 配额 -> 对话全链路）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
