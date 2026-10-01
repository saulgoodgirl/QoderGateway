import asyncio
import copy
import json
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any

import httpx

from . import encoding
from .auth import SessionContext, bearer_headers
from .env import httpx_client_kwargs, reasoning_mode


QODER_CHAT_URL_CN = "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1"
QODER_CHAT_URL = "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1"
# 新版协议（Qoder CLI 现行）：OpenAI 兼容端点，纯 Bearer，无 COSY 签名，响应为标准 OpenAI SSE。
# 性能远优于老版（老版默认带长 reasoning，复杂任务可到分钟级）。
QODER_CHAT_URL_NEW = "https://api2-v2.qoder.sh/model/v1/chat/completions"
# pass/ping 模式心跳间隔（秒）：上游静默超过该时长即向客户端补发 SSE 注释帧 `: ping`（仅在上游已产出首条事件后）。
KEEPALIVE_INTERVAL = 1.0


def now_ms() -> int:
    return int(time.time() * 1000)


def blank_response_meta() -> dict[str, Any]:
    return {
        "id": "",
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "completion_tokens_details": {"reasoning_tokens": 0},
            "prompt_tokens_details": {"cached_tokens": 0},
        },
    }


def template_base() -> dict[str, Any]:
    return {
        "request_id": str(uuid.uuid4()),
        "request_set_id": str(uuid.uuid4()),
        "chat_record_id": str(uuid.uuid4()),
        "stream": True,
        "chat_task": "FREE_INPUT",
        "chat_context": {
            "chatPrompt": "",
            "extra": {"context": [], "modelConfig": {"is_reasoning": False, "key": "lite"}, "originalContent": {"type": "text", "text": "hi"}},
            "features": [],
            "imageUrls": None,
            "text": {"type": "text", "text": "hi"},
        },
        "image_urls": None,
        "is_reply": True,
        "is_retry": False,
        "session_id": str(uuid.uuid4()),
        "code_language": "",
        "source": 1,
        "version": "3",
        "chat_prompt": "",
        "parameters": {"max_tokens": 32768},
        "aliyun_user_type": "personal_standard",
        "session_type": "qodercli",
        "agent_id": "agent_common",
        "task_id": "common",
        "model_config": {
            "key": "lite",
            "display_name": "Lite",
            "model": "",
            "format": "openai",
            "is_vl": False,
            "is_reasoning": False,
            "api_key": "",
            "url": "",
            "source": "system",
            "max_input_tokens": 180000,
        },
        "messages": [
            {
                "role": "system",
                "content": "You are Qoder, an interactive CLI tool that helps users with software engineering tasks.",
                "response_meta": blank_response_meta(),
                "reasoning_content_signature": "",
            }
        ],
        "tools": [],
        "business": {"product": "cli", "version": "0.1.43", "type": "agent", "id": str(uuid.uuid4()), "name": "hi", "begin_at": now_ms(), "stage": "start"},
    }


def normalize_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [normalize_content_part(item) for item in content]
        return "\n\n".join(part for part in parts if part.strip())
    return normalize_content_part(content)


def normalize_content_part(item: Any) -> str:
    if item is None:
        return ""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        if isinstance(item.get("text"), str):
            return item["text"]
        if item.get("type") in {"image_url", "input_image"} and isinstance(item.get("image_url"), dict):
            url = item["image_url"].get("url")
            if isinstance(url, str):
                return f"[image] {url}"
        if isinstance(item.get("content"), (dict, list)):
            return normalize_content(item["content"])
        return json.dumps(item, ensure_ascii=False)
    return json.dumps(item, ensure_ascii=False)


def normalize_message_text(message: dict[str, Any]) -> str:
    text = normalize_content(message.get("content"))
    return text if text.strip() else normalize_content(message.get("contents"))


def extract_latest_user_prompt(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages or []):
        if message.get("role") == "user":
            text = normalize_message_text(message)
            if text.strip():
                return text
    return ""


def build_user_message(text: str) -> dict[str, Any]:
    return {
        "role": "user",
        "content": "",
        "contents": [{"type": "text", "text": text}],
        "response_meta": blank_response_meta(),
        "reasoning_content_signature": "",
    }


def build_structured_message(role: str, text: str) -> dict[str, Any]:
    return {"role": role, "content": text or "", "response_meta": blank_response_meta(), "reasoning_content_signature": ""}


def normalize_tool_arguments(arguments: Any) -> str:
    if arguments is None:
        return ""
    if isinstance(arguments, str):
        return arguments
    return json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))


def normalize_tool_calls(raw_tool_calls: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw_tool_calls, list):
        return None
    normalized = []
    for raw in raw_tool_calls:
        function = raw.get("function", {}) if isinstance(raw, dict) else {}
        name = function.get("name", "")
        arguments = normalize_tool_arguments(function.get("arguments"))
        if not name and not arguments:
            continue
        normalized.append({"id": raw.get("id", ""), "type": raw.get("type", "function"), "function": {"name": name, "arguments": arguments}})
    return normalized or None


def parse_tool_calls_text(text: str | None) -> list[dict[str, Any]] | None:
    if not text:
        return None
    trimmed = text.strip()
    if not trimmed.startswith("Tool calls:"):
        return None
    payload = trimmed[len("Tool calls:") :].strip()
    if payload.startswith("```") and payload.endswith("```"):
        newline = payload.find("\n")
        if newline >= 0:
            payload = payload[newline + 1 : -3].strip()
    if not payload.startswith("["):
        return None
    try:
        return normalize_tool_calls(json.loads(payload))
    except json.JSONDecodeError:
        return None


def render_tool_result(message: dict[str, Any], text: str) -> str:
    label = "Tool result"
    if message.get("name"):
        label += f" ({message['name']})"
    if message.get("tool_call_id"):
        label += f" [{message['tool_call_id']}]"
    return f"{label}:\n{text}" if text.strip() else label


def convert_incoming_message(message: dict[str, Any], tools_enabled: bool) -> dict[str, Any] | None:
    role = message.get("role", "user")
    text = normalize_message_text(message)
    if not tools_enabled and message.get("tool_calls"):
        calls = json.dumps(message["tool_calls"], ensure_ascii=False)
        text = f"{text}\n\nTool calls:\n{calls}" if text.strip() else f"Tool calls:\n{calls}"
    if role == "tool":
        if tools_enabled:
            out = build_structured_message("tool", text)
            if message.get("name"):
                out["name"] = message["name"]
            if message.get("tool_call_id"):
                out["tool_call_id"] = message["tool_call_id"]
            return out
        role = "user"
        text = render_tool_result(message, text)
    if not text.strip() and not (tools_enabled and role == "assistant" and message.get("tool_calls")):
        return None
    if role == "user":
        return build_user_message(text)
    out = build_structured_message(role, text)
    if tools_enabled and role == "assistant":
        tool_calls = normalize_tool_calls(message.get("tool_calls")) or parse_tool_calls_text(text)
        if tool_calls:
            out["tool_calls"] = tool_calls
            if parse_tool_calls_text(text):
                out["content"] = ""
    return out


def build_qoder_messages(template_messages: list[dict[str, Any]], incoming: list[dict[str, Any]], prompt: str, tools_enabled: bool) -> list[dict[str, Any]]:
    rebuilt = []
    if not any(message.get("role") == "system" for message in incoming or []):
        rebuilt.extend(copy.deepcopy(message) for message in template_messages if message.get("role") == "system")
    for message in incoming or []:
        converted = convert_incoming_message(message, tools_enabled)
        if converted:
            rebuilt.append(converted)
    if not rebuilt and prompt.strip():
        rebuilt.append(build_user_message(prompt))
    return rebuilt


MODEL_ALIASES: dict[str, str] = {
    "qwen-3.8-max": "qmodel_38max",
    "qwen3.8-max": "qmodel_38max",
    "qwen-3.8-flash": "qfmodel",
    "qwen3.8-flash": "qfmodel",
    "qwen-3.7-max": "qmodel_latest",
    "qwen3.7-max": "qmodel_latest",
    "qwen-3.7-plus": "qmodel",
    "qwen3.7-plus": "qmodel",
    "qwen-3.7-flash": "q37fmodel",
    "qwen3.7-flash": "q37fmodel",
    "deepseek-v4-pro": "dmodel",
    "deepseek-v4": "dmodel",
    "deepseek": "dmodel",
    "deepseek-flash": "dfmodel",
    "glm-5.3": "gmodel",
    "glm-5.3-flash": "gfmodel",
    "glm-5.2": "gm51model",
    "kimi-k3": "kmodel_latest",
    "kimi": "kmodel_latest",
    "kimi-k2.8": "kmodel",
    "minimax-m2.7": "mmodel",
    "minimax": "mmodel",
    "lite": "lite",
    "auto": "auto",
}


def build_qoder_body(req: dict[str, Any], sess: SessionContext) -> tuple[dict[str, Any], str, bool]:
    """新版协议 body：OpenAI 原生格式，直接透传 messages/tools。"""
    raw_model = req.get("model") or "lite"
    model = MODEL_ALIASES.get(raw_model.lower(), raw_model)
    messages = req.get("messages") if isinstance(req.get("messages"), list) else []
    tools_enabled = bool(req.get("tools"))
    rid = str(uuid.uuid4())
    body: dict[str, Any] = {
        "model": model,
        "messages": copy.deepcopy(messages or []),
        "stream": True,
        "stream_options": {"include_usage": True},
        "metadata": {
            "context": {
                "request_id": rid,
                "request_set_id": rid,
                "session_id": str(uuid.uuid4()),
                "task_id": "common",
                "client_type": "qodercli",
            }
        },
    }
    if tools_enabled:
        body["tools"] = copy.deepcopy(req["tools"])
    return body, model, tools_enabled


@dataclass
class BridgeDelta:
    role: str = ""
    content: str = ""
    tool_calls: list[dict[str, Any]] | None = None
    reasoning: str = ""

    @property
    def is_empty(self) -> bool:
        return not self.role and not self.content and not self.tool_calls and not self.reasoning


def normalize_usage(usage: dict[str, Any]) -> dict[str, Any]:
    """usage 归一化（预留映射层）：标准 OpenAI 形状原样透传，常见变体键名做轻度映射，不伪造缺失字段。"""
    normalized = copy.deepcopy(usage)
    aliases = {
        "prompt_tokens": ("promptTokens", "input_tokens"),
        "completion_tokens": ("completionTokens", "output_tokens"),
        "total_tokens": ("totalTokens",),
    }
    for canonical, alternates in aliases.items():
        if isinstance(normalized.get(canonical), int):
            continue
        for alternate in alternates:
            if isinstance(normalized.get(alternate), int):
                normalized[canonical] = normalized[alternate]
                break
    details = normalized.get("prompt_tokens_details")
    if not isinstance(details, dict):
        details = {}
    if not isinstance(details.get("cached_tokens"), int):
        for source in ("cached_tokens", "cache_read_input_tokens"):
            if isinstance(normalized.get(source), int):
                details["cached_tokens"] = normalized[source]
                break
    if details:
        normalized["prompt_tokens_details"] = details
    return normalized


def extract_usage(payload_text: str) -> dict[str, Any] | None:
    """从一帧载荷提取上游 usage 统计：顶层 `usage`/`raw_usage`，或老协议 `body` 字符串内嵌；均无则 None。"""
    try:
        obj = json.loads(payload_text)
    except (TypeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    for key in ("usage", "raw_usage"):
        usage = obj.get(key)
        if isinstance(usage, dict) and usage:
            return normalize_usage(usage)
    inner = obj.get("body")
    if isinstance(inner, str) and inner:
        try:
            parsed_inner = json.loads(inner)
        except (TypeError, ValueError):
            parsed_inner = None
        if isinstance(parsed_inner, dict):
            for key in ("usage", "raw_usage"):
                usage = parsed_inner.get(key)
                if isinstance(usage, dict) and usage:
                    return normalize_usage(usage)
    return None


def extract_delta(data_line: str) -> BridgeDelta:
    try:
        obj = json.loads(data_line)
        if not isinstance(obj, dict):
            return BridgeDelta()
        # 新版：标准 OpenAI chunk（choices 直接在顶层）
        if "choices" in obj:
            for choice in obj.get("choices", []):
                delta = choice.get("delta", {}) if isinstance(choice, dict) else {}
                role = delta.get("role") or ""
                content = delta.get("content") or ""
                reasoning = delta.get("reasoning_content") or ""
                tool_calls = delta.get("tool_calls") if isinstance(delta.get("tool_calls"), list) else None
                if role or content or tool_calls or reasoning:
                    return BridgeDelta(role, content, tool_calls, reasoning)
            return BridgeDelta()
        # 老版：wrapper 内嵌 body 字符串
        inner = obj.get("body") or ""
        if not inner:
            return BridgeDelta()
        inner_json = json.loads(inner)
        for choice in inner_json.get("choices", []):
            delta = choice.get("delta", {})
            role = delta.get("role") or ""
            content = delta.get("content") or ""
            reasoning = delta.get("reasoning_content") or ""
            tool_calls = delta.get("tool_calls") if isinstance(delta.get("tool_calls"), list) else None
            if role or content or tool_calls or reasoning:
                return BridgeDelta(role, content, tool_calls, reasoning)
    except (TypeError, json.JSONDecodeError):
        return BridgeDelta()
    return BridgeDelta()


def make_chunk(chunk_id: str, created: int, model: str, delta: dict[str, Any] | None = None, finish_reason: str | None = None, usage: dict[str, Any] | None = None) -> dict[str, Any]:
    if usage is not None:
        # usage chunk：choices 恒为空数组（OpenAI include_usage 规范形状，[DONE] 前最后一帧）
        return {"id": chunk_id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": [], "usage": usage}
    return {"id": chunk_id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish_reason}]}


class ToolCallAccumulator:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def append(self, delta_calls: list[dict[str, Any]]) -> None:
        for delta in delta_calls:
            index = delta.get("index") if isinstance(delta.get("index"), int) else len(self.calls)
            while len(self.calls) <= index:
                self.calls.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            existing = self.calls[index]
            if isinstance(delta.get("id"), str):
                existing["id"] = delta["id"]
            if isinstance(delta.get("type"), str):
                existing["type"] = delta["type"]
            function = delta.get("function") or {}
            if isinstance(function.get("name"), str):
                existing["function"]["name"] = function["name"]
            if isinstance(function.get("arguments"), str):
                existing["function"]["arguments"] += function["arguments"]

    def snapshot(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self.calls)


async def qoder_stream_lines(sess: SessionContext, body: dict[str, Any], model: str) -> AsyncIterator[str]:
    region = getattr(sess.identity, "region", "cn")
    if region == "cn":
        # 国内版 Qoder CN 走 gateway.qoder.com.cn SSE
        chat_url = QODER_CHAT_URL_CN
        encoded_body = encoding.encode(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode())
        extra = {"x-model-key": model, "x-model-source": body.get("model_config", {}).get("source", "system")}
        headers = bearer_headers(sess, chat_url, encoded_body, "text/event-stream", extra)
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15), **httpx_client_kwargs()) as client:
            async with client.stream("POST", chat_url, content=encoded_body, headers=headers) as response:
                if response.status_code != 200:
                    text = await response.aread()
                    raise RuntimeError(f"HTTP {response.status_code} {text.decode(errors='replace')}")
                async for line in response.aiter_lines():
                    if line:
                        yield line
    else:
        # 国际版 Qoder 走 api2-v2.qoder.sh/model/v1/chat/completions
        ctx = (body.get("metadata") or {}).get("context") or {}
        headers = {
            "Authorization": f"Bearer {sess.identity.security_oauth_token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            # 与 CN 分支 auth.py 一致：禁用压缩，避免 httpx 默认 gzip/br 造成粗粒度分块
            "Accept-Encoding": "identity",
            "User-Agent": "qoder/1.1.16",
            "X-Request-ID": ctx.get("request_id", ""),
            "X-Session-ID": ctx.get("session_id", ""),
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15), **httpx_client_kwargs()) as client:
            async with client.stream("POST", QODER_CHAT_URL_NEW, json=body, headers=headers) as response:
                if response.status_code != 200:
                    text = await response.aread()
                    raise RuntimeError(f"HTTP {response.status_code} {text.decode(errors='replace')}")
                async for line in response.aiter_lines():
                    if line:
                        yield line


async def stream_openai_response(req: dict[str, Any], sess: SessionContext) -> AsyncIterator[str]:
    body, model, tools_enabled = build_qoder_body(req, sess)
    chunk_id = "chatcmpl-" + uuid.uuid4().hex[:24]
    created = int(time.time())
    tool_calls = ToolCallAccumulator()
    mode = reasoning_mode()
    emitted = False
    pending = ""
    streaming_text = False
    pending_role = "assistant"
    usage_snapshot: dict[str, Any] | None = None

    def event(payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"

    def process_line(payload_text: str) -> Iterator[str]:
        """单帧处理：usage 采集 → reasoning 透传（pass）→ 既有正文/工具调用路径。"""
        nonlocal emitted, pending, streaming_text, pending_role, usage_snapshot
        # usage 帧（顶层 usage/raw_usage 或老协议 body 内嵌）：暂存后不 continue——同一帧可能还带 choices/finish
        usage = extract_usage(payload_text)
        if usage is not None:
            usage_snapshot = usage
        delta = extract_delta(payload_text)
        if delta.is_empty:
            return
        if delta.role:
            pending_role = delta.role
        if delta.reasoning:
            if mode == "pass":
                out_delta = {"reasoning_content": delta.reasoning}
                if not emitted:
                    out_delta["role"] = pending_role
                emitted = True
                yield event(make_chunk(chunk_id, created, model, out_delta))
        if delta.tool_calls:
            pending = "" if tools_enabled and pending.lstrip().startswith("Tool calls:") else pending
            indexed = []
            for index, call in enumerate(delta.tool_calls):
                item = copy.deepcopy(call)
                item.setdefault("index", index)
                indexed.append(item)
            tool_calls.append(indexed)
            out_delta = {"tool_calls": indexed}
            if not emitted:
                out_delta["role"] = pending_role
            emitted = True
            yield event(make_chunk(chunk_id, created, model, out_delta))
            return
        if not delta.content:
            return
        if not tools_enabled or streaming_text:
            out_delta = {"content": delta.content}
            if not emitted:
                out_delta["role"] = pending_role
            emitted = True
            streaming_text = True
            yield event(make_chunk(chunk_id, created, model, out_delta))
            return
        pending += delta.content
        candidate = pending.lstrip()
        if "Tool calls:".startswith(candidate):
            # 严格前缀（"T"/"To"/…）或恰好"Tool calls:"：最多持有一块待下一增量判定
            return
        if candidate.startswith("Tool calls:"):
            tail = candidate[len("Tool calls:") :].lstrip()
            if not tail or tail.startswith("[") or tail.startswith("```"):
                # 载荷形状可能是真工具调用（`[` 开头 / ``` 围栏）→ 维持持有，流尾统一解析（行为不变）
                return
            # P1-2：前缀后首个非空白字符既非 `[` 也非围栏 → 不可能是工具调用载荷，立即按正文放行
        streaming_text = True
        out_delta = {"content": pending}
        if not emitted:
            out_delta["role"] = pending_role
        emitted = True
        pending = ""
        yield event(make_chunk(chunk_id, created, model, out_delta))

    if mode == "drop":
        # 逃生舱：保持修复前的 async for 直读路径（无心跳、无 reasoning 透传）
        async for line in qoder_stream_lines(sess, body, model):
            if not line.startswith("data:"):
                continue
            for out in process_line(line[5:].strip()):
                yield out
    else:
        # pass/ping：任务式等待上游（严禁 asyncio.wait_for——其超时会取消待决 __anext__，毁掉 httpx 流）；
        # 仅在上游已产出首条事件（received）之后，静默 ≥KEEPALIVE_INTERVAL 才发 SSE 注释心跳，
        # 保住「上游确认产出前失败仍可在回 200 前换号/重试」的请求级语义。
        it = qoder_stream_lines(sess, body, model).__aiter__()
        task: asyncio.Future[str] | None = None
        received = False
        try:
            while True:
                if task is None:
                    task = asyncio.ensure_future(it.__anext__())
                done, _ = await asyncio.wait({task}, timeout=KEEPALIVE_INTERVAL)
                if not done:
                    if received:
                        # `: ping` 是 SSE 注释帧（非语义 chunk），不占 role 注入位，role 留给首个语义增量
                        yield ": ping\n\n"
                    continue
                try:
                    line = task.result()
                except StopAsyncIteration:
                    break
                finally:
                    task = None
                received = True
                if not line.startswith("data:"):
                    continue
                for out in process_line(line[5:].strip()):
                    yield out
        finally:
            # 客户端放弃连接等场景：取消待决上游读取，避免悬挂的 httpx 流
            if task is not None:
                task.cancel()

    parsed_calls = parse_tool_calls_text(pending) if tools_enabled else None
    if parsed_calls:
        indexed = []
        for index, call in enumerate(parsed_calls):
            item = copy.deepcopy(call)
            item.setdefault("index", index)
            indexed.append(item)
        tool_calls.append(indexed)
        out_delta = {"tool_calls": indexed}
        if not emitted:
            out_delta["role"] = pending_role
        emitted = True
        yield event(make_chunk(chunk_id, created, model, out_delta))
    elif pending:
        out_delta = {"content": pending}
        if not emitted:
            out_delta["role"] = pending_role
        emitted = True
        yield event(make_chunk(chunk_id, created, model, out_delta))
    finish_reason = "tool_calls" if tool_calls.calls else "stop"
    yield event(make_chunk(chunk_id, created, model, {}, finish_reason))
    # usage 补发（OpenAI include_usage 惯例）：finish 帧之后、[DONE] 之前；上游未提供则不补发（宁缺勿造）
    if usage_snapshot is not None:
        yield event(make_chunk(chunk_id, created, model, usage=usage_snapshot))
    yield "data: [DONE]\n\n"


async def complete_openai_response(req: dict[str, Any], sess: SessionContext) -> dict[str, Any]:
    body, model, tools_enabled = build_qoder_body(req, sess)
    completion_id = "chatcmpl-" + uuid.uuid4().hex[:24]
    created = int(time.time())
    full = []
    tool_calls = ToolCallAccumulator()
    usage_snapshot: dict[str, Any] | None = None
    async for line in qoder_stream_lines(sess, body, model):
        if not line.startswith("data:"):
            continue
        payload_text = line[5:].strip()
        # usage 帧（顶层 usage/raw_usage 或老协议 body 内嵌）：采集后继续既有处理（同帧可能还带 choices）
        usage = extract_usage(payload_text)
        if usage is not None:
            usage_snapshot = usage
        delta = extract_delta(payload_text)
        if delta.content:
            full.append(delta.content)
        if delta.tool_calls:
            tool_calls.append(delta.tool_calls)
    content = "".join(full)
    fallback_tool_calls = None if tool_calls.calls or not tools_enabled else parse_tool_calls_text(content)
    message: dict[str, Any] = {"role": "assistant"}
    if fallback_tool_calls:
        message["content"] = None
        message["tool_calls"] = fallback_tool_calls
    elif not content and tool_calls.calls:
        message["content"] = None
    else:
        message["content"] = content
    if tool_calls.calls:
        message["tool_calls"] = tool_calls.snapshot()
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if tool_calls.calls or fallback_tool_calls else "stop"}],
        # 回填上游真实 usage；上游未提供时维持零值结构（不伪造数值）
        "usage": usage_snapshot
        or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
