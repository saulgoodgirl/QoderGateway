#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QoderGateway 本地 mock 上游端到端验证（桌面验证工具）。

无需真实 Qoder 账号/外网：本脚本在本机拉起完整网关（uvicorn + FastAPI +
真实 bridge 流式管线），并挂一个 mock 上游，对 /v1/chat/completions 做
流式/非流式多场景断言：

- usage 转发：raw_usage / usage / finish 同帧 / [DONE] 前补发顺序 / 非流式回填
- reasoning_content 透传与首个语义块 role 注入
- SSE 注释心跳 `: ping`（静默窗口触发、received 门控）
- 零正文守卫：pass=200 截断（reasoning 已流出）/ drop=502（换号窗口保留）
- 带内错误（event:error + provider_error）→ 502
- P1-2：`Tool calls:` 文本立即放行 / 真工具调用正常解析
- drop 模式：无 reasoning、无心跳（usage 仍转发，按 P0-1 设计）
- 防御头：X-Accel-Buffering: no；intl 分支 Accept-Encoding: identity

用法（仓库根目录）：
    .venv/bin/python scripts/verify_stream_mock.py
依赖：fastapi / uvicorn / httpx（见 requirements.txt）。
注：C3/C4/C5 的守卫/带内错误断言依赖配套修复（带内错误检测 + 零正文守卫）；基座不含时自动跳过相应断言。
退出码：0=全部通过；1=存在失败。
"""

from __future__ import annotations

import dataclasses
import json
import os
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

# —— 环境隔离：临时 DB、本机流量绕过沙箱代理、默认 pass 模式 ——
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"
_tmpdir = tempfile.mkdtemp(prefix="qg_verify_")
os.environ["DB_PATH"] = str(Path(_tmpdir) / "verify.db")
os.environ.pop("QODER_PAT", None)
os.environ["QODER_REASONING_MODE"] = "pass"

import httpx  # noqa: E402
import uvicorn  # noqa: E402

from qoder2api.encoding import decode as qoder_decode  # noqa: E402
from qoder2api.database import init_db  # noqa: E402
from qoder2api.auth import AuthIdentity, SessionContext  # noqa: E402
import qoder2api.bridge as bridge_mod  # noqa: E402
import qoder2api.app as app_mod  # noqa: E402

# 配套修复（带内错误检测/零正文守卫）在位时为真——决定 C3/C4/C5 的断言形态
HAS_INBAND_GUARD = hasattr(bridge_mod, "detect_upstream_error")


# --------------------------------------------------------------------------
# Mock 上游：按请求 model（解出 CN 编码 body / 明文 JSON）选择场景输出 SSE
# --------------------------------------------------------------------------

USAGE_CN = {
    "prompt_tokens": 11,
    "completion_tokens": 22,
    "total_tokens": 33,
    "prompt_tokens_details": {"cached_tokens": 7},
}
USAGE_INTL = {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "prompt_tokens_details": {"cached_tokens": 1}}


def _cn(inner: dict) -> str:
    """老协议 wrapper 帧：{"headers":..., "body": "<inner json string>"}"""
    return "data:" + json.dumps({"headers": {"Content-Type": ["application/json"]}, "body": json.dumps(inner, ensure_ascii=False)}, ensure_ascii=False) + "\n\n"


def _cn_raw(body: str) -> str:
    return "data:" + json.dumps({"headers": {}, "body": body}, ensure_ascii=False) + "\n\n"


def _std(chunk: dict) -> str:
    return "data:" + json.dumps(chunk, ensure_ascii=False) + "\n\n"


def _delta(d: dict, finish=None) -> dict:
    return {"choices": [{"index": 0, "delta": d, "finish_reason": finish}]}


def scenario_frames(model: str):
    """返回 [(delay_before_seconds, raw_text)] 或 None（未知模型 → 404）。"""
    if model == "mock-normal":
        return [
            (0.0, _cn(_delta({"role": "assistant"}))),
            (0.15, _cn(_delta({"reasoning_content": "首"}))),
            (0.15, _cn(_delta({"reasoning_content": "先"}))),
            (0.15, _cn(_delta({"reasoning_content": "推理"}))),
            (2.6, _cn(_delta({"content": "你"}))),  # 静默窗口：应触发 >=2 次心跳
            (0.15, _cn(_delta({"content": "好"}))),
            (0.15, _cn(_delta({"content": "，世界"}))),
            (0.10, _cn({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "raw_usage": USAGE_CN})),
            (0.0, _cn_raw("[DONE]")),
        ]
    if model == "mock-slow-start":
        return [
            (2.4, _cn({"choices": [{"index": 0, "delta": {"role": "assistant", "reasoning_content": "慢"}, "finish_reason": None}]})),
            (0.10, _cn(_delta({"content": "到"}))),
            (0.05, _cn({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11}})),
            (0.0, _cn_raw("[DONE]")),
        ]
    if model == "mock-reasoning-only":
        return [
            (0.0, _cn(_delta({"role": "assistant"}))),
            (0.10, _cn(_delta({"reasoning_content": "想1"}))),
            (0.10, _cn(_delta({"reasoning_content": "想2"}))),
            (0.10, _cn({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"total_tokens": 9}})),
            (0.0, _cn_raw("[DONE]")),
        ]
    if model == "mock-inband-error":
        return [
            (0.0, 'event:error\ndata:{"code":"provider_error","message":"boom"}\n\n'),
        ]
    if model == "mock-tooltext":
        return [
            (0.0, _cn(_delta({"role": "assistant"}))),
            (0.10, _cn(_delta({"content": "Tool calls: hel"}))),
            (0.10, _cn(_delta({"content": "lo world"}))),
            (0.05, _cn({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})),
            (0.0, _cn_raw("[DONE]")),
        ]
    if model == "mock-toolcall":
        payload = '[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"hz\\"}"}}]'
        return [
            (0.0, _cn(_delta({"role": "assistant"}))),
            (0.10, _cn(_delta({"content": "Tool calls: "}))),
            (0.10, _cn(_delta({"content": payload}))),
            (0.05, _cn({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})),
            (0.0, _cn_raw("[DONE]")),
        ]
    if model == "mock-intl":
        return [
            (0.0, _std({"id": "c1", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})),
            (0.10, _std({"id": "c1", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "你"}, "finish_reason": None}]})),
            (0.10, _std({"id": "c1", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "好"}, "finish_reason": None}]})),
            (0.05, _std({"id": "c1", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})),
            (0.0, _std({"id": "c1", "object": "chat.completion.chunk", "choices": [], "usage": USAGE_INTL})),
            (0.0, "data:[DONE]\n\n"),
        ]
    return None


class MockUpstream(BaseHTTPRequestHandler):
    server_version = "MockQoder/1.0"

    def log_message(self, *args):  # noqa: D102
        pass

    def do_POST(self):  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body = json.loads(raw)
        except Exception:
            try:
                body = json.loads(qoder_decode(raw.decode("utf-8", "replace")))
            except Exception:
                body = {}
        model = str(body.get("model") or "") if isinstance(body, dict) else ""
        self.server.last_request = {  # type: ignore[attr-defined]
            "path": self.path,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "model": model,
        }
        frames = scenario_frames(model)
        if frames is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"unknown scenario")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            for delay, text in frames:
                if delay:
                    time.sleep(delay)
                self.wfile.write(text.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


# --------------------------------------------------------------------------
# 网关侧打补丁：上游 URL → mock；会话/账号 → 假实现（流式桥接是本次被测对象）
# --------------------------------------------------------------------------

STATE = {"region": "cn"}


def make_session(region: str) -> SessionContext:
    """按当前基座的数据类字段构造会话（兼容 enterprise_domain 等改造字段的有无）。"""
    ident_kwargs = dict(
        name="Mock Account", aid="", uid="mock-uid-0001", yx_uid="",
        organization_id="", organization_name="", user_type="personal_standard",
        security_oauth_token="dt-mock-token", refresh_token="drt-mock",
        region=region, enterprise_domain="",
    )
    ident_names = {f.name for f in dataclasses.fields(AuthIdentity)}
    ident = AuthIdentity(**{k: v for k, v in ident_kwargs.items() if k in ident_names})
    sess_kwargs = dict(
        temp_key=b"m" * 16, cosy_key="mock-cosy-key", info="mock-info",
        identity=ident, machine_id="mock-machine-id",
        machine_token="mock-machine-token", machine_type="mock-machine-type", region=region,
    )
    sess_names = {f.name for f in dataclasses.fields(SessionContext)}
    return SessionContext(**{k: v for k, v in sess_kwargs.items() if k in sess_names})


async def fake_get_session(target_account=None):  # noqa: ARG001
    return make_session(STATE["region"])


def patch_gateway(mock_port: int) -> None:
    # 兼容两种基线：CN URL 常量可能内联（上游）或拆分 _QODER_CHAT_PATH_CN（企业改造）——按 URL 结构重建
    parts = urllib.parse.urlsplit(bridge_mod.QODER_CHAT_URL_CN)
    query = f"?{parts.query}" if parts.query else ""
    bridge_mod.QODER_CHAT_URL_CN = f"http://127.0.0.1:{mock_port}" + parts.path + query
    bridge_mod.QODER_CHAT_URL_NEW = f"http://127.0.0.1:{mock_port}/model/v1/chat/completions"
    app_mod.db_load_accounts = lambda: {"accounts": [{"uid": "mock-uid-0001", "enabled": True, "api_mode": "all"}]}
    app_mod.get_active_account_record = lambda target_account=None, preferred_provider=None: {
        "uid": "mock-uid-0001", "name": "Mock Account", "provider": "qoder",
    }
    app_mod.get_session = fake_get_session
    app_mod.start_refresh_loop = lambda: None
    app_mod.start_checkin_loop = lambda: None


# --------------------------------------------------------------------------
# 客户端辅助：带时间戳的流式收集 / 非流式 JSON
# --------------------------------------------------------------------------


def call_stream(base: str, model: str, *, tools=None, mode="pass", region="cn", timeout=30.0):
    os.environ["QODER_REASONING_MODE"] = mode
    STATE["region"] = region
    payload = {"model": model, "messages": [{"role": "user", "content": "hi"}], "stream": True}
    if tools:
        payload["tools"] = tools
    events: list[tuple[float, str]] = []
    stream_err = None
    with httpx.Client(trust_env=False, timeout=timeout) as client:
        t0 = time.monotonic()  # 从发起请求计时：网关"先取首块再回 200"的持有时间可被观测
        with client.stream("POST", base + "/v1/chat/completions", json=payload, headers={"Authorization": "Bearer mock"}) as resp:
            status = resp.status_code
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            body_text = ""
            if status == 200:
                try:
                    for line in resp.iter_lines():
                        events.append((time.monotonic() - t0, line))
                except httpx.HTTPError as exc:  # 中途截断属预期路径之一
                    stream_err = repr(exc)
            else:
                body_text = resp.read().decode("utf-8", "replace")
    return status, hdrs, events, body_text, stream_err


def call_json(base: str, model: str, *, mode="pass", region="cn"):
    os.environ["QODER_REASONING_MODE"] = mode
    STATE["region"] = region
    with httpx.Client(trust_env=False, timeout=30.0) as client:
        resp = client.post(
            base + "/v1/chat/completions",
            json={"model": model, "messages": [{"role": "user", "content": "hi"}], "stream": False},
            headers={"Authorization": "Bearer mock"},
        )
        try:
            data = resp.json()
        except Exception:
            data = {"_raw": resp.text}
        return resp.status_code, data


def data_lines(events):
    return [(t, l[5:].strip()) for t, l in events if l.startswith("data:")]


def parsed_chunks(events):
    out = []
    for t, p in data_lines(events):
        try:
            out.append((t, json.loads(p)))
        except Exception:
            pass
    return out


def pings(events):
    return [t for t, l in events if l.startswith(":")]


def delta_of(chunk: dict):
    try:
        return chunk["choices"][0].get("delta") or {}
    except Exception:
        return {}


def content_texts(events):
    return [v for v in (delta_of(c).get("content") for _, c in parsed_chunks(events)) if v is not None]


# --------------------------------------------------------------------------
# 断言与场景
# --------------------------------------------------------------------------

FAILURES: list[str] = []


def check(name: str, cond: bool, evidence: str = "") -> bool:
    tag = "PASS" if cond else "FAIL"
    line = f"  [{tag}] {name}" + (f"  | {evidence}" if evidence else "")
    print(line, flush=True)
    if not cond:
        FAILURES.append(name)
    return cond


def run_cases(base: str, mock: MockUpstream) -> None:
    # C1 正常流（CN wrapper，pass 模式）：usage/reasoning/心跳/顺序/role
    print("\n[C1] mock-normal（CN，pass）：reasoning 透传 + 心跳 + usage 补发 + 顺序", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-normal")
    check("C1 HTTP 200", status == 200, f"status={status}")
    check("C1 X-Accel-Buffering: no", hdrs.get("x-accel-buffering") == "no", hdrs.get("x-accel-buffering", "-"))
    chunks = parsed_chunks(events)
    reasoning = [(t, c) for t, c in chunks if delta_of(c).get("reasoning_content")]
    contents = [(t, c) for t, c in chunks if delta_of(c).get("content")]
    finish_idx = next((i for i, (t, l) in enumerate(data_lines(events)) if '"finish_reason":"stop"' in l), -1)
    usage_idx = next((i for i, (t, c) in enumerate(chunks) if c.get("choices") == [] and isinstance(c.get("usage"), dict)), -1)
    dl = data_lines(events)
    check("C1 reasoning 透传 3 块", len(reasoning) == 3, f"n={len(reasoning)}")
    check("C1 首个语义块带 role", reasoning and delta_of(reasoning[0][1]).get("role") == "assistant", str(delta_of(reasoning[0][1]) if reasoning else None))
    check("C1 正文 3 块原文", [delta_of(c).get("content") for _, c in contents] == ["你", "好", "，世界"], str([delta_of(c).get("content") for _, c in contents]))
    check("C1 finish 帧存在", finish_idx >= 0)
    check("C1 usage 帧存在且 choices=[]", usage_idx >= 0)
    if usage_idx >= 0:
        usage_obj = chunks[usage_idx][1]["usage"]
        check("C1 usage 值透传（raw_usage 同帧）", usage_obj.get("prompt_tokens") == 11 and usage_obj.get("completion_tokens") == 22 and usage_obj.get("total_tokens") == 33, json.dumps(usage_obj, ensure_ascii=False))
        check("C1 cached_tokens 有值", (usage_obj.get("prompt_tokens_details") or {}).get("cached_tokens") == 7, json.dumps(usage_obj.get("prompt_tokens_details"), ensure_ascii=False))
    check("C1 [DONE] 收尾", dl and dl[-1][1] == "[DONE]")
    check("C1 顺序 finish < usage < [DONE]", 0 <= finish_idx < usage_idx < len(dl) - 1, f"finish={finish_idx} usage={usage_idx} last={len(dl)-1}")
    r_last = reasoning[-1][0] if reasoning else 0
    c_first = contents[0][0] if contents else 0
    gap_pings = [t for t in pings(events) if r_last < t < c_first]
    first_data_t = dl[0][0] if dl else 0
    pre_first = [t for t in pings(events) if t < first_data_t]
    check("C1 静默窗口心跳 >=2 次", len(gap_pings) >= 2, f"gap={c_first-r_last:.2f}s pings={[round(t,2) for t in gap_pings]}")
    check("C1 首事件前无心跳（received 门控）", len(pre_first) == 0, str(pre_first))

    # C2 慢启动（2.4s）：首字节前不发心跳，首个语义块即开流
    print("\n[C2] mock-slow-start：received 门控 + 慢首帧", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-slow-start")
    dl = data_lines(events)
    first_t = dl[0][0] if dl else 0
    check("C2 HTTP 200", status == 200, f"status={status}")
    check("C2 首事件 >=2.3s（上游慢启动）", first_t >= 2.3, f"first={first_t:.2f}s")
    check("C2 首事件前零字节（无 ping）", not pings(events), f"pings={[round(t,2) for t in pings(events)]}")
    contents = content_texts(events)
    check("C2 正文到达", contents == ["到"], str(contents))
    usage_chunks = [c for _, c in parsed_chunks(events) if c.get("choices") == [] and isinstance(c.get("usage"), dict)]
    check("C2 usage 帧（顶层 usage 键）", usage_chunks and usage_chunks[0]["usage"].get("total_tokens") == 11, json.dumps(usage_chunks, ensure_ascii=False))

    # C3 reasoning-only（pass）：200 + reasoning 流出 + 无 finish/usage/[DONE]（截断）
    print("\n[C3] mock-reasoning-only（pass）：守卫截断（reasoning 已流出）", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-reasoning-only")
    dl = data_lines(events)
    reasoning = [(t, c) for t, c in parsed_chunks(events) if delta_of(c).get("reasoning_content")]
    check("C3 HTTP 200（200 已开流）", status == 200, f"status={status}")
    check("C3 reasoning 已流出 2 块", len(reasoning) == 2, f"n={len(reasoning)}")
    if HAS_INBAND_GUARD:
        check("C3 无 finish 帧", not any('"finish_reason":"stop"' in l for _, l in dl))
        check("C3 无 usage 帧", not any('"usage"' in l for _, l in dl))
        check("C3 无 [DONE]", not any(l == "[DONE]" for _, l in dl))
    else:
        print("  [SKIP] C3 截断断言（零正文守卫来自配套修复，本基座不含）", flush=True)

    # C4 reasoning-only（drop）：守卫前置 → 502（换号窗口保留）
    print("\n[C4] mock-reasoning-only（drop）：守卫前置 502", flush=True)
    if HAS_INBAND_GUARD:
        status, hdrs, events, body, err = call_stream(base, "mock-reasoning-only", mode="drop")
        check("C4 HTTP 502", status == 502, f"status={status}")
        check("C4 错误信息含 reasoning-only", "reasoning-only" in body, body[:120])
    else:
        print("  [SKIP] C4（零正文守卫来自配套修复，本基座不含）", flush=True)

    # C5 带内错误首帧 → 502
    print("\n[C5] mock-inband-error：带内错误 → 502", flush=True)
    if HAS_INBAND_GUARD:
        status, hdrs, events, body, err = call_stream(base, "mock-inband-error")
        check("C5 HTTP 502", status == 502, f"status={status}")
        check("C5 错误信息含上游错误事件", "上游错误事件" in body, body[:140])
    else:
        print("  [SKIP] C5（带内错误检测来自配套修复，本基座不含）", flush=True)

    # C6 P1-2：Tool calls: 文本立即放行
    print("\n[C6] mock-tooltext（tools）：`Tool calls:` 文本立即放行", flush=True)
    tools = [{"type": "function", "function": {"name": "get_weather", "description": "", "parameters": {"type": "object", "properties": {}}}}]
    status, hdrs, events, body, err = call_stream(base, "mock-tooltext", tools=tools)
    contents = content_texts(events)
    check("C6 HTTP 200", status == 200, f"status={status}")
    check("C6 文本分两块实时放行", contents == ["Tool calls: hel", "lo world"], str(contents))
    dl = data_lines(events)
    check("C6 finish=stop（未误判工具调用）", any('"finish_reason":"stop"' in l for _, l in dl))

    # C7 真工具调用载荷：维持持有并解析
    print("\n[C7] mock-toolcall（tools）：真工具载荷解析", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-toolcall", tools=tools)
    chunks = parsed_chunks(events)
    tool_chunks = [(t, c) for t, c in chunks if delta_of(c).get("tool_calls")]
    dl = data_lines(events)
    check("C7 HTTP 200", status == 200, f"status={status}")
    check("C7 tool_calls 帧存在（get_weather）", tool_chunks and delta_of(tool_chunks[0][1])["tool_calls"][0]["function"]["name"] == "get_weather", str(delta_of(tool_chunks[0][1]) if tool_chunks else None)[:160])
    check("C7 finish=tool_calls", any('"finish_reason":"tool_calls"' in l for _, l in dl))
    check("C7 无正文帧", not any(delta_of(c).get("content") for _, c in chunks))

    # C8 intl 新协议：标准 usage 帧 + Accept-Encoding: identity
    print("\n[C8] mock-intl：新协议标准 usage + identity 头", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-intl", region="intl")
    dl = data_lines(events)
    contents = content_texts(events)
    usage_chunks = [c for _, c in parsed_chunks(events) if c.get("choices") == [] and isinstance(c.get("usage"), dict)]
    sent_acc_enc = mock.last_request["headers"].get("accept-encoding", "")  # type: ignore[attr-defined]
    check("C8 HTTP 200", status == 200, f"status={status}")
    check("C8 正文到达", contents == ["你", "好"], str(contents))
    check("C8 intl usage 帧透传", bool(usage_chunks) and (usage_chunks[0]["usage"].get("prompt_tokens_details") or {}).get("cached_tokens") == 1, json.dumps(usage_chunks, ensure_ascii=False))
    check("C8 intl 请求 Accept-Encoding: identity", sent_acc_enc == "identity", f"got={sent_acc_enc!r}")
    check("C8 [DONE] 收尾", dl and dl[-1][1] == "[DONE]")

    # C9 非流式：usage 回填真实值
    print("\n[C9] mock-normal（stream=false）：usage 回填", flush=True)
    status, data = call_json(base, "mock-normal")
    check("C9 HTTP 200", status == 200, f"status={status}")
    check("C9 正文拼接", (data.get("choices") or [{}])[0].get("message", {}).get("content") == "你好，世界", str((data.get("choices") or [{}])[0].get("message", {}).get("content"))[:60])
    check("C9 usage 非零回填", (data.get("usage") or {}).get("total_tokens") == 33 and (data.get("usage") or {}).get("prompt_tokens_details", {}).get("cached_tokens") == 7, json.dumps(data.get("usage"), ensure_ascii=False))

    # C10 drop 模式：无 reasoning、无心跳；usage 仍转发（P0-1 设计）
    print("\n[C10] mock-normal（drop）：等价旧行为 + usage", flush=True)
    status, hdrs, events, body, err = call_stream(base, "mock-normal", mode="drop")
    chunks = parsed_chunks(events)
    contents = content_texts(events)
    reasoning = [c for _, c in chunks if delta_of(c).get("reasoning_content")]
    dl = data_lines(events)
    check("C10 HTTP 200", status == 200, f"status={status}")
    check("C10 无 reasoning 帧", not reasoning)
    check("C10 无心跳", not pings(events))
    check("C10 正文 3 块", contents == ["你", "好", "，世界"], str(contents))
    check("C10 usage 仍转发", any(c.get("choices") == [] and isinstance(c.get("usage"), dict) for _, c in chunks))
    check("C10 [DONE] 收尾", dl and dl[-1][1] == "[DONE]")


def main() -> int:
    print("=" * 74)
    print("QoderGateway mock 上游端到端验证（桌面验证）")
    print(f"temp DB: {os.environ['DB_PATH']}")
    init_db()

    mock = ThreadingHTTPServer(("127.0.0.1", 0), MockUpstream)
    mock.daemon_threads = True
    mock_port = mock.server_address[1]
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    print(f"mock upstream: http://127.0.0.1:{mock_port}")

    patch_gateway(mock_port)

    config = uvicorn.Config(app_mod.app, host="127.0.0.1", port=0, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        print("ERROR: gateway failed to start")
        return 1
    gateway_port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{gateway_port}"
    print(f"gateway: {base}")
    print("=" * 74)

    try:
        run_cases(base, mock)
    finally:
        server.should_exit = True
        mock.shutdown()

    print("=" * 74)
    print(f"RESULT: {len(FAILURES)} failed" if FAILURES else "RESULT: ALL PASS")
    for f in FAILURES:
        print(f"  - FAILED: {f}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
