# 快速开始

本页说明如何从零启动 GITIT 多厂商 AI 聚合网关，管理 Qoder 与 ZCode 账号池，并完成第一次统一 API 调用。

## 快速入门

按顺序完成这三步：

- 启动 GITIT 服务（本地运行或连接云端网关）。
- 管理多厂商账号池（Qoder PAT、ZCode 凭据）与请求路由模式。
- 完成第一次 OpenAI 兼容 API 调用，或通过客户端接入。

## 安装并启动

### 方式一：云端部署直连（推荐）
如果你已经将 GITIT 部署在 Server A 云主机（`35.212.220.77`）并绑定域名，直接访问控制台即可：

```text
https://lite.bigbob.asia/console
```

统一 API 端点为：
```text
https://lite.bigbob.asia/v1
```

### 方式二：本地运行

先克隆仓库并安装依赖：

```bash
git clone https://github.com/saulgoodgirl/QoderGateway.git
cd QoderGateway
uv sync
```

Windows 环境可通过根目录的 `start.bat` 一键启动，或使用命令行：

```powershell
uv run qoder2api
```

本地 WebUI 控制台地址：

```text
http://127.0.0.1:5050/console
```

## 登录与修改默认密码

默认网关登录密码是：

```text
admin
```

第一次启动后可以直接用 `admin` 登录控制台。

强烈建议你在生产环境中立刻修改管理员密码。复制环境变量模板：

```bash
cp .env.example .env
```

然后在 `.env` 中设置安全密码：

```env
QODER_ADMIN_PASSWORD=your-strong-password
```

这个密码用于保护所有 `/ui/*` 管理接口，前端控制台会自动把它作为 `X-Gateway-Token` 发送。

## 管理多平台账号池

GITIT 聚合了国内版 Qoder 与智谱 ZCode 双平台，支持多种接入方式：

### 1. 接入 Qoder 账号
- 在控制台点击 **接入新账号**，选择 **Qoder**，粘贴 Qoder Personal Access Token（PAT，前缀为 `pt-...`）。
- 或在本地运行模式下点击 **Auto Import**，直接读取当前机器上的 Qoder 本地登录会话。
- 账号入库后将由系统自动换取长效 Session 并由守护进程定期保活。

### 2. 接入智谱 ZCode 账号
- 点击 **接入新账号**，选择 **ZCode**，输入智谱开放平台 API Key 或粘贴本地导出的 ZCode 凭据。
- 在本地运行模式下支持自动读取 `%LOCALAPPDATA%\ZCode` 本地存储的会话凭证。

### 3. 三种 API 调度模式
对每个账号可单独设置调度行为：
- **全部通用轮询 (all)**：参与全网关的常规负载均衡与自动轮转。
- **专属定向调用 (dedicated)**：仅在客户端请求中显式传入 `model@account` 时调用，不被常规请求消耗。
- **离线维保 (disabled)**：暂停处理外部 API 请求，但后台守护进程仍会为其每日自动打卡与领券！

## 双轨自动打卡与领券

GITIT 内置双时钟守护进程（Autonomous Schedule Daemons）：
- **Qoder 官方权益打卡**：每日 10:00:05 (UTC+8) 准时为个人版账号自动领取 **+100 Credits 算力加油包**（30天有效，企业 Teams 账号自动免签过滤）。
- **ZCode 领券特权**：每日 00:00:05 (UTC+8) 准时为 ZCode 账号自动申领 **1 亿 Token 免费算力包**。
- 网关启动 3 秒内会自动执行全量补漏检查，避免停机期间漏领。

## 完成第一次 API 调用

账号就绪后，直接向 `/v1/chat/completions` 发起标准 OpenAI 请求：

```bash
curl https://lite.bigbob.asia/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \
  -d '{
    "model": "glm-4-flash",
    "messages": [{ "role": "user", "content": "你好，请写一个 Python 快速排序算法" }],
    "stream": true
  }'
```

### 指定账号定向调用
如果你想强制使用特定账号进行测试：
```bash
-d '{
  "model": "kimi-k3@liuzhuyun",
  "messages": [{ "role": "user", "content": "请分析架构" }]
}'
```

## 验证请求路由

打开控制台的 **服务分流日志 (Logs)**，每次请求都会实时展示流量分发详情与调度耗时：

```text
[INFO] HTTP POST /v1/chat/completions (model=glm-4-flash) 200 OK SSE Stream Dispatched (Latency: 284ms)
```

## 下一步

- 阅读 **鉴权机制**：了解管理 Token 与客户端 Bearer Key 的安全隔离。
- 阅读 **账号池**：深入掌握多厂商多账号轮转与额度自动熔断。
- 阅读 **API 参考**：查看 18+ 款主流模型矩阵与 Cursor / Codex++ / Cherry Studio 接入参数。
