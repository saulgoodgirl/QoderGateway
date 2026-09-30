# API Reference

GITIT exposes standard OpenAI-compatible endpoints (`/v1/chat/completions` and `/v1/models`) supporting multi-provider AI backends.

## Base URL

- **Cloud Endpoint**: `https://lite.bigbob.asia/v1`
- **Local Endpoint**: `http://127.0.0.1:5050/v1`

## Chat Completions

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <your-api-key>
```

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `model` | string | Yes | Model ID or targeted routing identifier (e.g. `kimi-k3`, `glm-4-flash`, `kimi-k3@liuzhuyun`). |
| `messages` | array | Yes | Standard OpenAI message objects. |
| `stream` | boolean | No | Enable Server-Sent Events (SSE) streaming (default `false`). |
| `temperature` | number | No | Sampling temperature (default `0.7`). |

### 18+ Verified Models

- **Qoder Upstream**: `kimi-k3` (1M), `deepseek-v4-pro` (1M), `qwen-3.8-max` (1M), `deepseek-flash` (128K), `kimi-k2.8` (200K), `qwen-3.8-flash` (1M)
- **ZCode Upstream**: `glm-4-flash` (128K), `glm-4` (128K), `glm-4-plus` (128K), `glm-4-air` (128K)

### Targeted Routing

- `model: "kimi-k3@liuzhuyun"`: Routes specifically to the `liuzhuyun` account.
- `model: "glm-4-flash@zcode"`: Routes to any active account in the `zcode` pool.
