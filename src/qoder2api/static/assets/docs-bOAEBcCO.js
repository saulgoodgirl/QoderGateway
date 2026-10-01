import{i as e,n as t,r as n,s as r,t as i}from"./jsx-runtime-C_jTJn-e.js";import{i as a,n as o,r as s,t as c}from"./lib-BeWZ5vbO.js";var l=`# Account Pool & Autonomous Maintenance

GITIT unifies multiple upstream provider accounts (domestic Qoder, Zhipu ZCode, and custom OpenAI-compatible endpoints) into a single resilient routing pool with automatic failover.

## Supported Providers & Import Methods

| Provider | Credential | Method |
| :--- | :--- | :--- |
| **Qoder** | PAT (\`pt-...\`) / OAuth Session | Paste PAT in console or click Auto Import locally |
| **ZCode** | Zhipu API Key (\`sk-...\` / ID.Secret) | Enter API Key or extract from \`%LOCALAPPDATA%\\ZCode\` |
| **Custom** | Standard Bearer Key + Base URL | Enter custom OpenAI endpoint |

## Three API Routing Modes

- **All (General Pool)**: Participates in global load-balancing and auto-failover.
- **Dedicated**: Excluded from generic calls; only triggered when requested via \`model: "<model>@<account_name>"\`.
- **Disabled**: Excluded from all API traffic, while continuing to receive daily autonomous check-in rewards!

## Dual Autonomous Maintenance Daemons

1. **Qoder 10:00:05 (UTC+8)**: Automatically claims **+100 Credits** daily for personal accounts (30 days validity). Enterprise Teams accounts are automatically bypassed.
2. **ZCode 00:00:05 (UTC+8)**: Automatically claims **100,000,000 Tokens** daily for ZCode accounts.
3. **Boot-time Reconciliation**: Runs 3 seconds after startup to claim any missed rewards immediately.

## Quota Tracking

- \`provider\`: Upstream provider identifier (\`qoder\`, \`zcode\`, \`custom\`).
- \`quota\`: Balance in Credits (Qoder) or Tokens (ZCode).
- \`api_mode\`: Routing configuration (\`all\`, \`dedicated\`, \`disabled\`).
`,u=`# 双平台账号池与自动维保

GITIT 账号池支持将多个上游厂商（国内版 Qoder、智谱 ZCode 及自定义 OpenAI 兼容接口）的账号集中纳管，并在遇到限流、额度耗尽或上游故障时自动平滑故障转移。

## 支持的厂商与导入方式

| 厂商 | 凭证类型 | 导入方式 |
| :--- | :--- | :--- |
| **Qoder** | RFC 8628 OAuth 免密会话 / PAT 令牌 (\`pt-...\`) | 控制台一键弹窗扫码/网页授权（对齐 9Router 方案），或粘贴 PAT 令牌 |
| **ZCode** | 智谱 BigModel API Key (\`sk-...\` / ID.Secret) | 控制台输入密钥，自动解构读取本地 \`%LOCALAPPDATA%\\ZCode\\v2\\config.json\` |
| **Custom** | 标准 OpenAI 兼容 API Key + Base URL | 控制台直接录入自定义厂商端点 |

## 自动去重与凭据更新

系统以统一 \`uid\` / 账号标识进行唯一索引。重复导入同名账号时，会自动更新 Session 令牌与有效时间，绝不会产生脏数据。

## 三种 API 调度模式

在账号池表格中，可为每个账号独立切换调度模式：

- **全部通用轮询 (all)**：默认模式。当外部客户端发起无指定后缀的调用（如 \`model: "kimi-k3"\`）时，网关在此池中轮询调度，自动规避限流与故障。
- **专属定向调用 (dedicated)**：隔离保护模式。该账号不会被公共请求消耗，仅当客户端请求显式指定 \`model: "<model>@<account_name>"\` 时才会分发至该账号。
- **离线维保 (disabled)**：维护模式。暂时切断该账号的外部 API 流量，但网关后台仍会按时为其执行每日自动打卡与领券任务！

## 双轨定时守护进程与权益自动领取

GITIT 内置全天候自主守护线程（Autonomous Schedule Daemons）：

1. **Qoder 每日 10:00:05 (UTC+8) 自动打卡**：
   - 为账号池内所有 Qoder 个人版账号自动领取官方每日放量的 **+100 算力加油包**（领取后 30 天有效）。
   - 自动识别并过滤企业 Teams 账号（因其使用组织统筹算力，免除无效打卡）。
2. **ZCode 每日 00:00:05 (UTC+8) 1 亿 Token 申领**：
   - 自动调用智谱开放平台权益接口，为全部在库 ZCode 账号申领当天的 **100,000,000 Tokens** 免费特权。
3. **开机自愈补漏**：
   - 网关重启或开机 3 秒内，自动检查今日是否已有账号未打卡，如未打卡立即执行补领。

## 账号状态与额度监控

| 字段 | 含义 |
| :--- | :--- |
| \`provider\` | 上游厂商类型（\`qoder\` / \`zcode\` / \`custom\`）。 |
| \`quota\` | 当前可用剩余算力（Qoder 为 Credits，ZCode 为 Tokens）。 |
| \`api_mode\` | 调度模式（\`all\` / \`dedicated\` / \`disabled\`）。 |
| \`is_quota_exceeded\` | 是否达到上游额度阈值，若超额网关会自动跳过该账号进行容灾。 |
| \`last_status\` | 最近一次保活刷新状态与时间戳。 |
`,d='# API Reference\n\nGITIT exposes standard OpenAI-compatible endpoints (`/v1/chat/completions` and `/v1/models`) supporting multi-provider AI backends.\n\n## Base URL\n\n- **Cloud Endpoint**: `https://lite.bigbob.asia/v1`\n- **Local Endpoint**: `http://127.0.0.1:5050/v1`\n\n## Chat Completions\n\n```http\nPOST /v1/chat/completions\nContent-Type: application/json\nAuthorization: Bearer <your-api-key>\n```\n\n### Request Parameters\n\n| Parameter | Type | Required | Description |\n| :--- | :--- | :--- | :--- |\n| `model` | string | Yes | Model ID or targeted routing identifier (e.g. `kimi-k3`, `glm-4-flash`, `kimi-k3@liuzhuyun`). |\n| `messages` | array | Yes | Standard OpenAI message objects. |\n| `stream` | boolean | No | Enable Server-Sent Events (SSE) streaming (default `false`). |\n| `temperature` | number | No | Sampling temperature (default `0.7`). |\n\n### 18+ Verified Models\n\n- **Qoder Upstream**: `kimi-k3` (1M), `deepseek-v4-pro` (1M), `qwen-3.8-max` (1M), `deepseek-flash` (128K), `kimi-k2.8` (200K), `qwen-3.8-flash` (1M)\n- **ZCode Upstream**: `glm-4-flash` (128K), `glm-4` (128K), `glm-4-plus` (128K), `glm-4-air` (128K)\n\n### Targeted Routing\n\n- `model: "kimi-k3@liuzhuyun"`: Routes specifically to the `liuzhuyun` account.\n- `model: "glm-4-flash@zcode"`: Routes to any active account in the `zcode` pool.\n',f=`# API 参考

GITIT 提供完全符合 OpenAI 标准的 Chat Completions 与 Models 接口，向下游工具（Cursor、Codex++、Cherry Studio、NextChat、ZCode）提供多厂商聚合算力。

## 服务端点 (Base URL)

- **云端公网端点**：\`https://lite.bigbob.asia/v1\`
- **本地运行端点**：\`http://127.0.0.1:5050/v1\`

## 模型列表查询

\`\`\`http
GET /v1/models
Authorization: Bearer <your-api-key>
\`\`\`

返回当前网关已聚合接入的全部可用模型（包含 Qoder 与 ZCode 全系列）。

## 聊天补全接口 (Chat Completions)

\`\`\`http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <your-api-key>
\`\`\`

### 核心请求参数

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| \`model\` | string | 是 | 模型名称，支持原生模型标识或定向后缀（如 \`kimi-k3\`、\`glm-4-flash\`、\`kimi-k3@liuzhuyun\`）。 |
| \`messages\` | array | 是 | 标准 OpenAI 消息数组，包含 \`role\` 与 \`content\`。 |
| \`stream\` | boolean | 否 | 是否启用 SSE 流式输出，默认为 \`false\`。 |
| \`temperature\` | number | 否 | 采样温度，默认为 \`0.7\`。 |

### 18+ 款主流模型矩阵

| 厂商 | 模型标识 | 上下文 | 特点 |
| :--- | :--- | :--- | :--- |
| **Qoder** | \`kimi-k3\` | 1M | 月暗旗舰，超长代码深度推理 |
| **Qoder** | \`deepseek-v4-pro\` | 1M | 顶级架构设计与严谨逻辑 |
| **Qoder** | \`qwen-3.8-max\` | 1M | 阿里通义全能旗舰 |
| **Qoder** | \`deepseek-flash\` | 128K | 极速首字补全 |
| **Qoder** | \`kimi-k2.8\` | 200K | 轻量高性价比 |
| **ZCode** | \`glm-4-flash\` | 128K | 智谱极速模型，毫秒级响应 |
| **ZCode** | \`glm-4\` | 128K | 经典高智能通用模型 |
| **ZCode** | \`glm-4-plus\` | 128K | 高阶语义理解与长文本推理 |
| **ZCode** | \`glm-4-air\` | 128K | 均衡轻量模型 |

### 定向路由调用语法
除了直接传入模型名称外，GITIT 支持灵活的定向语法：
- \`kimi-k3@liuzhuyun\`：强制使用名为 \`liuzhuyun\` 的账号发起请求。
- \`glm-4-flash@zcode\`：强制分发给 \`zcode\` 厂商的账号池。

### 流式请求示例 (cURL)

\`\`\`bash
curl https://lite.bigbob.asia/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \\
  -d '{
    "model": "glm-4-flash",
    "stream": true,
    "messages": [
      {"role": "system", "content": "You are a senior engineer."},
      {"role": "user", "content": "用 Python 写一个异步生产者消费者模型"}
    ]
  }'
\`\`\`

### Python SDK 接入示例

\`\`\`python
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
\`\`\`
`,p=`# Architecture & Routing Engine

GITIT is a high-performance multi-provider AI aggregation gateway engineered with Python FastAPI and React.

## Request Flow

\`\`\`text
Client (Cursor / Codex++ / Cherry Studio / OpenAI SDK)
  │
  ▼ POST /v1/chat/completions
GITIT Unified Core
  ├─ 1. Bearer API Key validation & sub-pool lookup
  ├─ 2. Routing selector (model@account or load-balanced pool)
  ├─ 3. Upstream Dispatcher:
  │    ├─ QoderEngine (PAT exchange, signature, quota management)
  │    ├─ ZCodeEngine (AES decryption, GLM SSE stream adaptation)
  │    └─ CustomEngine (OpenAI compatible pass-through)
  ▼
Upstream AI Providers (Qoder / Zhipu AI / Custom)
\`\`\`

## Backend Modules

- \`app.py\`: Main application, \`/v1\` endpoints, \`/ui\` APIs, and cloud registrar defense.
- \`accounts.py\`: Account CRUD, failover logic, and targeted routing (\`model@account\`).
- \`zcode.py\`: ZCode AES credentials decryption and GLM stream bridging.
- \`auth.py\`: Qoder PAT exchange and session signature.
- \`checkin.py\`: Dual autonomous schedule daemons for daily claiming.
- \`database.py\`: Multi-provider SQLite persistence.
`,m=`# 架构与调度内核

GITIT 是一个面向多厂商的高性能 AI 聚合网关，采用轻量异步 Python (FastAPI) 内核与现代化前端控制台构建。

## 整体架构流转

\`\`\`text
客户端 (Cursor / Codex++ / Cherry Studio / SDK)
  │
  ▼ [HTTP POST /v1/chat/completions]
┌────────────────────────────────────────────────────────┐
│                   GITIT 网关调度内核                    │
│                                                        │
│  1. Bearer API Key 校验 & 子池定向过滤                   │
│  2. 路由决策器 (model@account / 动态负载均衡)          │
│                                                        │
│   ┌─────────────────────┬─────────────────────┐        │
│   │   Qoder 适配引擎    │   ZCode 适配引擎    │        │
│   │  (PAT 签名/会话保活)│ (GLM 协议桥接/流式) │        │
│   └──────────┬──────────┴──────────┬──────────┘        │
└──────────────┼─────────────────────┼───────────────────┘
               ▼                     ▼
        国内版 Qoder 官方      智谱开放平台 ZCode
\`\`\`

## 核心后端模块

| 模块 | 职责与技术实现 |
| :--- | :--- |
| \`app.py\` | FastAPI 应用程序总入口、统一端点路由、UI 管理接口、云端注册机防穿透拦截（\`ENABLE_REGISTRAR=false\`）。 |
| \`accounts.py\` | SQLite 账号持久化、多厂商凭据纳管、\`model@account\` 精准路由决策与故障自动熔断。 |
| \`zcode.py\` | 智谱 ZCode 凭据解密（AES-256-GCM）、GLM 全系列模型标准化适配、双向流式 SSE 协议转换。 |
| \`auth.py\` | Qoder Personal Access Token (PAT) 自动换票、国内版 Bearer 鉴权签名与额度同步。 |
| \`checkin.py\` | 双轨定时守护进程：10:00:05 Qoder 每日签到与 00:00:05 ZCode 1 亿 Token 自动申领。 |
| \`database.py\` | SQLite 数据库管理，包含 \`accounts\`（带 \`provider\` 标识）、\`api_keys\` 与 \`settings\`。 |

## 前端技术栈与双状态交互

前端控制台由 Vite + React + Tailwind CSS + GSAP 构建：
- **双状态图标系统**：采用 Material Symbols 可变字体，激活项采用实心填色（\`FILL 1\`），未激活项采用描边轮廓（\`FILL 0\`）。
- **静态交付输出**：构建产物统一输出至 \`src/qoder2api/static\`，由 FastAPI 直接提供生产级静态文件托管。
`,h=`# Authentication

GITIT employs a two-layer security model that completely isolates administrative controls from client-facing API consumption.

## Layer 1: Admin Console Token (\`X-Gateway-Token\`)

Controls access to all \`/ui/*\` management endpoints:
- Dashboard status and cluster health
- Multi-provider account pool management
- Autonomous check-in and claiming controls
- API key generation and sub-pool bindings
- System logs

Configure in \`.env\`:
\`\`\`env
QODER_ADMIN_PASSWORD=your-secure-password
\`\`\`

## Layer 2: External Client Bearer Keys

Clients authenticate using standard Bearer tokens:

\`\`\`http
Authorization: Bearer <qg_live_xxx>
\`\`\`

### Sub-Pool Binding
Each API key can either:
- Dispatch requests across the entire account pool (default).
- Bind exclusively to a dedicated upstream account for isolated quota consumption.
`,g=`# 鉴权机制

GITIT 采用双层鉴权模型：管理控制台鉴权与外部客户端 API 鉴权，实现管理特权与消费端调用的彻底隔离。

## 第一层：管理控制台鉴权 (X-Gateway-Token)

你在控制台登录页输入的密码即为管理密钥。前端控制台向后端发起配置、查库或管理请求时会自动在 Header 中附带：

\`\`\`http
X-Gateway-Token: <admin-password>
\`\`\`

该密钥保护以下管理接口：
- \`/ui/status\`：系统总览与节点探活
- \`/ui/accounts\` 与 \`/ui/accounts/*\`：账号池增删改查
- \`/ui/checkin/*\`：双轨自动签到状态与手动补领
- \`/ui/config\`：API Key 密钥生成与子池映射
- \`/ui/logs\`：实时系统分流日志

### 生产环境修改方式
在 \`.env\` 中指定：
\`\`\`env
QODER_ADMIN_PASSWORD=your-super-safe-password
\`\`\`

## 第二层：外部 API Key 鉴权 (Bearer Key)

当第三方客户端（Cursor、Codex++、Cherry Studio、NextChat、ZCode 客户端）连接网关时，通过标准 HTTP Bearer 协议进行鉴权：

\`\`\`http
Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350
\`\`\`

### API Key 子池绑定 (Sub-pool Binding)
在控制台 **API Key & 子池绑定** 板块中，可为每个 API Key 配置不同权限：
- **全部账号 (默认轮询)**：可调用全网关所有处于 \`all\` 状态的账号，享用最大并发与可用性。
- **专属账号绑定**：指定此 Key 仅消耗特定账号的算力（如个人号或特定组织的套餐），实现团队成员间的算力物理隔离。

## 第三层：上游厂商 OAuth 2.0 设备代码鉴权 (RFC 8628 Device Authorization)

为免去用户手动提取和管理 PAT 令牌的繁琐，GITIT 原生支持类似 9Router 的 **OAuth 2.0 设备授权流（Device Flow, RFC 8628）**：

1. **PKCE S256 挑战生成**：前端发起授权请求，后端生成 32 字节高熵 Verifier 与 SHA-256 Challenge，生成 8 位短用户代码（User Code，例如 \`36DC4F40\`）与设备唯一 Nonce。
2. **免密授权弹窗**：在控制台点击 **Qoder 免密授权**，一键复制授权 URL 或直接打开浏览器进行一键授权。
3. **后台智能轮询自动入库**：网关后台以 2 秒间隔安全轮询 \`https://openapi.qoder.com.cn/api/v1/deviceToken/poll\`，用户在浏览器确认授权后，网关毫秒级获取 Token、自动查询账号基础信息并写入 SQLite 账号池参与调度。

## 安全建议

- 永远不要将管理控制台密码直接配置给下游客户端作为 API Key。
- 云端部署建议保持 API Key 鉴权为开启状态（默认即开启）。
- Qoder OAuth 设备授权通过 PKCE S256 防护，即使链接暴露也无法被第三方恶意窃取 Token。
`,_='# Operations & Deployment\n\nOperational procedures, database maintenance, and security guidelines for GITIT.\n\n## Deployment Modes\n\n### 1. Cloud Production Deployment (Server A)\n- **Host**: Linux Server A (`35.212.220.77:22`), Docker mapped to port `5050`.\n- **Public Domain**: `https://lite.bigbob.asia`.\n- **Automated Deployer**: Run `python scripts/deploy_remote.py` for hash-based differential upload and hot-reloading.\n\n### 2. Local Environment\n- **Host**: Windows 11 with `start.bat` or `uv run qoder2api`.\n- Default port: `5050`.\n\n## Database Management\n\nPersistence path:\n```text\n~/.qoder/qoder2api.db\n```\n\nBackup via PowerShell:\n```powershell\nCopy-Item "$env:USERPROFILE\\.qoder\\qoder2api.db" "$env:USERPROFILE\\Desktop\\gitit_db_backup.db"\n```\n\n## Cloud Registrar Safety Policy\n\n- The automated registrar is strictly restricted to local deployment.\n- On Cloud Server A, `ENABLE_REGISTRAR=false` is enforced. Any incoming request to `/ui/registrar/*` is blocked with `403 Forbidden`.\n',v=`# 运维与部署规范

本页记录 GITIT 网关在云端与本地环境下的运维、数据库维护以及关键安全守则。

## 部署模式

### 1. 云端生产部署 (Server A)
- **部署环境**：Server A Linux 主机（\`35.212.220.77:22\`）Docker 容器，端口映射 \`5050\`。
- **公网域名**：\`https://lite.bigbob.asia\`。
- **自动部署脚本**：工程内置 \`scripts/deploy_remote.py\`，支持基于文件哈希的增量极速部署与热加载。
- **容器健康检查**：
  \`\`\`bash
  docker ps -f name=qodergateway
  docker logs -f --tail 50 qodergateway
  \`\`\`

### 2. 本地开发与测试
- **环境**：Windows 11，直接运行根目录下 \`start.bat\`。
- **端口管理**：默认占用 \`5050\` 端口。当切换至云端使用时，建议主动关闭本地占用的 5050 端口：
  \`\`\`powershell
  Get-NetTCPConnection -LocalPort 5050 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  \`\`\`

## 数据库与备份规范

GITIT 运行数据持久化保存在用户目录的 SQLite 数据库：

\`\`\`text
~/.qoder/qoder2api.db
\`\`\`

包含核心数据表：
- \`accounts\`：所有 Qoder、ZCode 账号凭证、额度与 API 调度模式。
- \`api_keys\`：对外分发的 Bearer API Key 及其子池绑定关系。
- \`settings\`：网关全局配置与管理员密码哈希。

### 备份命令 (PowerShell)
\`\`\`powershell
Copy-Item "$env:USERPROFILE\\.qoder\\qoder2api.db" "$env:USERPROFILE\\Desktop\\gitit_db_backup.db"
\`\`\`

## 云端注册机安全守则 (重要)

- **云端环境强制拦截**：自动批量注册机功能**仅限本地部署使用**。
- 云端 Server A 部署默认设置 \`ENABLE_REGISTRAR=false\`。任何向 \`/ui/registrar/*\` 发起的请求均会被后端直接拦截并返回 \`403 Forbidden\`。
- 云端 Web 控制台已彻底下线注册机的前端入口，杜绝恶意探测与风控风险。

## 常见排障与日志诊断

### 401 Unauthorized
- 若在 Web 控制台报错：检查是否登录已过期或管理员密码不正确。
- 若在客户端（Cursor 等）报错：检查请求 Header 中的 \`Authorization: Bearer <key>\` 是否正确有效。

### 上游模型报错 502 / 超额
- 检查控制台「双平台账号池」中对应厂商的账号是否已满额度。
- GITIT 会自动熔断并尝试轮询到池内下一个有效账号。如果全部账号均超额，可通过控制台一键重领算力或添加新账号。
`,y=`# Quickstart

This page explains how to get started with the GITIT Multi-Provider AI Aggregation Gateway, manage Qoder and ZCode account pools, and complete your first unified API request.

## Quick Overview

Follow these three steps:

- Start GITIT (cloud-hosted or locally).
- Manage multi-provider accounts (Qoder PATs, ZCode credentials) and API routing modes.
- Complete your first OpenAI-compatible API call or connect client IDEs.

## Installation & Startup

### Option 1: Cloud Deployment (Recommended)
If GITIT is deployed on Server A (\`35.212.220.77\`) with Cloudflare, access the console directly:

\`\`\`text
https://lite.bigbob.asia/console
\`\`\`

The unified API endpoint is:
\`\`\`text
https://lite.bigbob.asia/v1
\`\`\`

### Option 2: Local Deployment

Clone the repository and install dependencies:

\`\`\`bash
git clone https://github.com/saulgoodgirl/QoderGateway.git
cd QoderGateway
uv sync
\`\`\`

Launch with \`start.bat\` on Windows or run:

\`\`\`powershell
uv run qoder2api
\`\`\`

Web Console: \`http://127.0.0.1:5050/console\`

## Admin Password Configuration

The default gateway token is:

\`\`\`text
admin
\`\`\`

In production, change your admin password in \`.env\`:

\`\`\`env
QODER_ADMIN_PASSWORD=your-strong-password
\`\`\`

This token protects all \`/ui/*\` administrative endpoints.

## Multi-Provider Account Pool

GITIT natively unifies Qoder and Zhipu ZCode:

### 1. Adding Qoder Accounts
- Click **Add Account**, select **Qoder**, and enter your PAT (\`pt-...\`).
- Or use **Auto Import** in local mode to extract local Qoder sessions.

### 2. Adding ZCode Accounts
- Click **Add Account**, select **ZCode**, and enter your Zhipu API key or exported credentials.

### 3. API Routing Modes
- **All (General Pool)**: Participates in global load-balancing and auto-failover.
- **Dedicated**: Only called when explicitly specified via \`model@account\` syntax.
- **Disabled**: Excluded from API routing, while continuing to receive daily automated maintenance and claiming!

## Dual Autonomous Maintenance Daemons

- **Qoder Rewards**: 10:00:05 (UTC+8) claims **+100 Credits** daily for personal accounts (30 days validity).
- **ZCode Rewards**: 00:00:05 (UTC+8) claims **100,000,000 Tokens** daily.

## First API Request

\`\`\`bash
curl https://lite.bigbob.asia/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \\
  -d '{
    "model": "glm-4-flash",
    "messages": [{ "role": "user", "content": "Hello from GITIT" }],
    "stream": true
  }'
\`\`\`

### Targeted Account Routing
\`\`\`bash
-d '{
  "model": "kimi-k3@liuzhuyun",
  "messages": [{ "role": "user", "content": "Analyze this code" }]
}'
\`\`\`
`,b=`# 快速开始

本页说明如何从零启动 GITIT 多厂商 AI 聚合网关，管理 Qoder 与 ZCode 账号池，并完成第一次统一 API 调用。

## 快速入门

按顺序完成这三步：

- 启动 GITIT 服务（本地运行或连接云端网关）。
- 管理多厂商账号池（Qoder PAT、ZCode 凭据）与请求路由模式。
- 完成第一次 OpenAI 兼容 API 调用，或通过客户端接入。

## 安装并启动

### 方式一：云端部署直连（推荐）
如果你已经将 GITIT 部署在 Server A 云主机（\`35.212.220.77\`）并绑定域名，直接访问控制台即可：

\`\`\`text
https://lite.bigbob.asia/console
\`\`\`

统一 API 端点为：
\`\`\`text
https://lite.bigbob.asia/v1
\`\`\`

### 方式二：本地运行

先克隆仓库并安装依赖：

\`\`\`bash
git clone https://github.com/saulgoodgirl/QoderGateway.git
cd QoderGateway
uv sync
\`\`\`

Windows 环境可通过根目录的 \`start.bat\` 一键启动，或使用命令行：

\`\`\`powershell
uv run qoder2api
\`\`\`

本地 WebUI 控制台地址：

\`\`\`text
http://127.0.0.1:5050/console
\`\`\`

## 登录与修改默认密码

默认网关登录密码是：

\`\`\`text
admin
\`\`\`

第一次启动后可以直接用 \`admin\` 登录控制台。

强烈建议你在生产环境中立刻修改管理员密码。复制环境变量模板：

\`\`\`bash
cp .env.example .env
\`\`\`

然后在 \`.env\` 中设置安全密码：

\`\`\`env
QODER_ADMIN_PASSWORD=your-strong-password
\`\`\`

这个密码用于保护所有 \`/ui/*\` 管理接口，前端控制台会自动把它作为 \`X-Gateway-Token\` 发送。

## 管理多平台账号池

GITIT 聚合了国内版 Qoder 与智谱 ZCode 双平台，支持多种接入方式：

### 1. 接入 Qoder 账号
- 在控制台点击 **接入新账号**，选择 **Qoder**，粘贴 Qoder Personal Access Token（PAT，前缀为 \`pt-...\`）。
- 或在本地运行模式下点击 **Auto Import**，直接读取当前机器上的 Qoder 本地登录会话。
- 账号入库后将由系统自动换取长效 Session 并由守护进程定期保活。

### 2. 接入智谱 ZCode 账号
- 点击 **接入新账号**，选择 **ZCode**，输入智谱开放平台 API Key 或粘贴本地导出的 ZCode 凭据。
- 在本地运行模式下支持自动读取 \`%LOCALAPPDATA%\\ZCode\` 本地存储的会话凭证。

### 3. 三种 API 调度模式
对每个账号可单独设置调度行为：
- **全部通用轮询 (all)**：参与全网关的常规负载均衡与自动轮转。
- **专属定向调用 (dedicated)**：仅在客户端请求中显式传入 \`model@account\` 时调用，不被常规请求消耗。
- **离线维保 (disabled)**：暂停处理外部 API 请求，但后台守护进程仍会为其每日自动打卡与领券！

## 双轨自动打卡与领券

GITIT 内置双时钟守护进程（Autonomous Schedule Daemons）：
- **Qoder 官方权益打卡**：每日 10:00:05 (UTC+8) 准时为个人版账号自动领取 **+100 Credits 算力加油包**（30天有效，企业 Teams 账号自动免签过滤）。
- **ZCode 领券特权**：每日 00:00:05 (UTC+8) 准时为 ZCode 账号自动申领 **1 亿 Token 免费算力包**。
- 网关启动 3 秒内会自动执行全量补漏检查，避免停机期间漏领。

## 完成第一次 API 调用

账号就绪后，直接向 \`/v1/chat/completions\` 发起标准 OpenAI 请求：

\`\`\`bash
curl https://lite.bigbob.asia/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \\
  -d '{
    "model": "glm-4-flash",
    "messages": [{ "role": "user", "content": "你好，请写一个 Python 快速排序算法" }],
    "stream": true
  }'
\`\`\`

### 指定账号定向调用
如果你想强制使用特定账号进行测试：
\`\`\`bash
-d '{
  "model": "kimi-k3@liuzhuyun",
  "messages": [{ "role": "user", "content": "请分析架构" }]
}'
\`\`\`

## 验证请求路由

打开控制台的 **服务分流日志 (Logs)**，每次请求都会实时展示流量分发详情与调度耗时：

\`\`\`text
[INFO] HTTP POST /v1/chat/completions (model=glm-4-flash) 200 OK SSE Stream Dispatched (Latency: 284ms)
\`\`\`

## 下一步

- 阅读 **鉴权机制**：了解管理 Token 与客户端 Bearer Key 的安全隔离。
- 阅读 **账号池**：深入掌握多厂商多账号轮转与额度自动熔断。
- 阅读 **API 参考**：查看 18+ 款主流模型矩阵与 Cursor / Codex++ / Cherry Studio 接入参数。
`,x=r(e(),1),S=r(n(),1),C=i(),w=Object.assign({"./docs/account-pool.md":l,"./docs/account-pool.zh.md":u,"./docs/api-reference.md":d,"./docs/api-reference.zh.md":f,"./docs/architecture.md":p,"./docs/architecture.zh.md":m,"./docs/authentication.md":h,"./docs/authentication.zh.md":g,"./docs/operations.md":_,"./docs/operations.zh.md":v,"./docs/quickstart.md":y,"./docs/quickstart.zh.md":b}),T=[{id:`quickstart`,title:`Quickstart`,zhTitle:`快速开始`,group:`Getting Started`,zhGroup:`入门`,icon:`rocket_launch`},{id:`authentication`,title:`Authentication`,zhTitle:`鉴权机制`,group:`Guides`,zhGroup:`指南`,icon:`shield_lock`},{id:`api-reference`,title:`API Reference`,zhTitle:`API 参考`,group:`Reference`,zhGroup:`参考`,icon:`api`},{id:`account-pool`,title:`Account Pool`,zhTitle:`账号池`,group:`Guides`,zhGroup:`指南`,icon:`account_balance_wallet`},{id:`operations`,title:`Operations`,zhTitle:`运维`,group:`Operations`,zhGroup:`运维`,icon:`terminal`},{id:`architecture`,title:`Architecture`,zhTitle:`架构`,group:`Reference`,zhGroup:`参考`,icon:`schema`}].map(e=>({...e,source:w[`./docs/${e.id}.md`]||``,zhSource:w[`./docs/${e.id}.zh.md`]||w[`./docs/${e.id}.md`]||``}));function E(e){return typeof e==`string`||typeof e==`number`?String(e):Array.isArray(e)?e.map(E).join(``):x.isValidElement(e)?E(e.props.children):``}function D(e){return E(e).toLowerCase().replace(/`/g,``).replace(/[^\p{L}\p{N}\s-]/gu,``).trim().replace(/\s+/g,`-`)}function O(e){document.getElementById(e)?.scrollIntoView({behavior:`smooth`,block:`start`}),history.replaceState(null,``,`#${e}`)}function k(){let[e,n]=(0,x.useState)(`quickstart`),[r,i]=(0,x.useState)(``),[l,u]=(0,x.useState)(!1),[d,f]=(0,x.useState)(()=>{let e=localStorage.getItem(`qodergate_lang`);return e===`en`||e===`zh`?e:navigator.language.toLowerCase().startsWith(`zh`)?`zh`:`en`}),p=(0,x.useRef)(null),m=(0,x.useRef)(null),h=T.find(t=>t.id===e)||T[0],g=d===`zh`?h.zhSource:h.source,_=d===`zh`?h.zhTitle:h.title,v=(0,x.useMemo)(()=>Array.from(g.matchAll(/^(#{2,3})\s+(.+)$/gm)).map(e=>({id:D(e[2]),text:e[2].replace(/`/g,``),depth:e[1].length})),[g]),y=(0,x.useMemo)(()=>{let e=r.trim().toLowerCase();return e?T.filter(t=>{let n=d===`zh`?t.zhTitle:t.title,r=d===`zh`?t.zhGroup:t.group,i=d===`zh`?t.zhSource:t.source;return n.toLowerCase().includes(e)||r.toLowerCase().includes(e)||i.toLowerCase().includes(e)}):T},[r,d]).reduce((e,t)=>{let n=d===`zh`?t.zhGroup:t.group;return e[n]=e[n]||[],e[n].push(t),e},{}),b=e=>{f(e),localStorage.setItem(`qodergate_lang`,e)};(0,x.useEffect)(()=>{p.current&&(t.fromTo(p.current,{opacity:0,y:18},{opacity:1,y:0,duration:.45,ease:`power2.out`}),window.scrollTo({top:0,behavior:`smooth`}))},[e]),(0,x.useEffect)(()=>{let e=e=>{e.key===`/`&&document.activeElement?.tagName!==`INPUT`&&(e.preventDefault(),m.current?.focus())};return window.addEventListener(`keydown`,e),()=>window.removeEventListener(`keydown`,e)},[]);let S=e=>{navigator.clipboard.writeText(e.replace(/\n$/,``)),u(!0),setTimeout(()=>u(!1),1400)};return(0,C.jsxs)(`div`,{className:`docs-shell min-h-screen`,children:[(0,C.jsxs)(`header`,{className:`docs-topbar`,children:[(0,C.jsxs)(`a`,{href:`/`,className:`docs-brand`,children:[(0,C.jsx)(`span`,{className:`docs-brand-icon`,children:(0,C.jsx)(`span`,{className:`material-symbols-outlined`,style:{fontVariationSettings:`'FILL' 1`,fontSize:20},children:`gate`})}),(0,C.jsx)(`span`,{children:d===`zh`?`GITIT 文档`:`GITIT Docs`})]}),(0,C.jsxs)(`div`,{className:`docs-search`,children:[(0,C.jsx)(`span`,{className:`material-symbols-outlined`,children:`search`}),(0,C.jsx)(`input`,{ref:m,value:r,onChange:e=>i(e.target.value),placeholder:d===`zh`?`搜索文档...`:`Search documentation...`}),(0,C.jsx)(`kbd`,{children:`/`})]}),(0,C.jsxs)(`nav`,{className:`docs-topnav`,children:[(0,C.jsx)(`button`,{onClick:()=>b(d===`zh`?`en`:`zh`),className:`docs-lang-switch`,children:d===`zh`?`English`:`中文`}),(0,C.jsx)(`a`,{href:`/console`,children:d===`zh`?`控制台`:`Console`}),(0,C.jsx)(`a`,{href:`/`,children:d===`zh`?`首页`:`Home`})]})]}),(0,C.jsxs)(`div`,{className:`docs-layout`,children:[(0,C.jsx)(`aside`,{className:`docs-sidebar`,children:Object.entries(y).map(([t,r])=>(0,C.jsxs)(`section`,{className:`docs-nav-group`,children:[(0,C.jsx)(`div`,{className:`docs-nav-title`,children:t}),r.map(t=>(0,C.jsxs)(`button`,{onClick:()=>n(t.id),className:`docs-nav-item ${e===t.id?`active`:``}`,children:[(0,C.jsx)(`span`,{className:`material-symbols-outlined`,children:t.icon}),d===`zh`?t.zhTitle:t.title]},t.id))]},t))}),(0,C.jsxs)(`main`,{ref:p,className:`docs-content`,children:[(0,C.jsx)(`div`,{className:`docs-hero`,children:(0,C.jsxs)(`div`,{children:[(0,C.jsx)(`div`,{className:`docs-eyebrow`,children:`QoderGate Wiki`}),(0,C.jsx)(`h1`,{children:_}),(0,C.jsx)(`p`,{children:d===`zh`?`面向快速上手、API 接入、账号池管理和本地运维的完整项目 Wiki。`:`Fast, polished documentation for using and operating the QoderGate local API gateway.`})]})}),(0,C.jsx)(`article`,{className:`markdown-body`,children:(0,C.jsx)(a,{remarkPlugins:[s,o],rehypePlugins:[c],components:{h1(){return null},h2({children:e}){return(0,C.jsx)(`h2`,{id:D(e),children:e})},h3({children:e}){return(0,C.jsx)(`h3`,{id:D(e),children:e})},pre({children:e}){let t=String(e?.props?.children||``);return(0,C.jsxs)(`div`,{className:`code-card`,children:[(0,C.jsx)(`button`,{onClick:()=>S(t),children:l?`Copied`:`Copy`}),(0,C.jsx)(`pre`,{children:e})]})}},children:g})})]}),(0,C.jsx)(`aside`,{className:`docs-toc`,children:(0,C.jsxs)(`div`,{className:`docs-toc-card`,children:[(0,C.jsx)(`div`,{className:`docs-toc-title`,children:d===`zh`?`本页目录`:`On This Page`}),v.length===0?(0,C.jsx)(`p`,{children:d===`zh`?`暂无章节`:`No sections`}):v.map(e=>(0,C.jsx)(`button`,{onClick:()=>O(e.id),className:e.depth===3?`nested`:``,children:e.text},e.id))]})})]})]})}S.createRoot(document.getElementById(`root`)).render((0,C.jsx)(k,{}));