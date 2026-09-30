# API 参考

GITIT 提供完全符合 OpenAI 标准的 Chat Completions 与 Models 接口，向下游工具（Cursor、Codex++、Cherry Studio、NextChat、ZCode）提供多厂商聚合算力。

## 服务端点 (Base URL)

- **云端公网端点**：`https://lite.bigbob.asia/v1`
- **本地运行端点**：`http://127.0.0.1:5050/v1`

## 模型列表查询

```http
GET /v1/models
Authorization: Bearer <your-api-key>
```

返回当前网关已聚合接入的全部可用模型（包含 Qoder 与 ZCode 全系列）。

## 聊天补全接口 (Chat Completions)

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <your-api-key>
```

### 核心请求参数

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `model` | string | 是 | 模型名称，支持原生模型标识或定向后缀（如 `kimi-k3`、`glm-4-flash`、`kimi-k3@liuzhuyun`）。 |
| `messages` | array | 是 | 标准 OpenAI 消息数组，包含 `role` 与 `content`。 |
| `stream` | boolean | 否 | 是否启用 SSE 流式输出，默认为 `false`。 |
| `temperature` | number | 否 | 采样温度，默认为 `0.7`。 |

### 18+ 款主流模型矩阵

| 厂商 | 模型标识 | 上下文 | 特点 |
| :--- | :--- | :--- | :--- |
| **Qoder** | `kimi-k3` | 1M | 月暗旗舰，超长代码深度推理 |
| **Qoder** | `deepseek-v4-pro` | 1M | 顶级架构设计与严谨逻辑 |
| **Qoder** | `qwen-3.8-max` | 1M | 阿里通义全能旗舰 |
| **Qoder** | `deepseek-flash` | 128K | 极速首字补全 |
| **Qoder** | `kimi-k2.8` | 200K | 轻量高性价比 |
| **ZCode** | `glm-4-flash` | 128K | 智谱极速模型，毫秒级响应 |
| **ZCode** | `glm-4` | 128K | 经典高智能通用模型 |
| **ZCode** | `glm-4-plus` | 128K | 高阶语义理解与长文本推理 |
| **ZCode** | `glm-4-air` | 128K | 均衡轻量模型 |

### 定向路由调用语法
除了直接传入模型名称外，GITIT 支持灵活的定向语法：
- `kimi-k3@liuzhuyun`：强制使用名为 `liuzhuyun` 的账号发起请求。
- `glm-4-flash@zcode`：强制分发给 `zcode` 厂商的账号池。

### 流式请求示例 (cURL)

```bash
curl https://lite.bigbob.asia/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \
  -d '{
    "model": "glm-4-flash",
    "stream": true,
    "messages": [
      {"role": "system", "content": "You are a senior engineer."},
      {"role": "user", "content": "用 Python 写一个异步生产者消费者模型"}
    ]
  }'
```

### Python SDK 接入示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://lite.bigbob.asia/v1",
    api_key="qg_live_42adacf1b759ee4e6e8a7ea99f9eb350"
)

response = client.chat.completions.create(
    model="kimi-k3",
    messages=[{"role": "user", "content": "写一个基于 FastAPI 的接口"}],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
```
