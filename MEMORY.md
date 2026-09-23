# Qoder代理 对话记忆库 (MEMORY.md)

> 本文档记录「Qoder代理」专属对话中的服务器环境、SSH凭据、接口反代规范、PAT 令牌、部署模式及用户协作习惯。

---

## 1. 所属服务器环境与核心凭证 (已固化)

| 配置项 | 参数值 / 规范 | 说明 |
| :--- | :--- | :--- |
| **服务器标识** | **Server A (2C1G 轻量云主机)** | 与 9Router / AstrBot 跑在同一台云主机上 |
| **公网 IP** | `35.212.220.77` | 远端 Docker 服务所在主机公网 IP |
| **SSH 端口** | `22` | 标准远程连接端口 |
| **SSH 登录用户** | `root` | 系统最高管理员账号 |
| **SSH 登录密码** | `826525931` | 远程认证与终端连接密码 |
| **云端 Docker 服务端口** | `http://35.212.220.77:5050` | 宿主机直接映射端口 |
| **Docker 内部网络别名** | `http://qodergateway:5050/v1` | 供 9Router 同网络内网直连（零公网消耗） |
| **Web 控制台地址** | `https://lite.bigbob.asia/console` | 亦可访问 `http://35.212.220.77:5050/console` |
| **Web 控制台访问密码** | `admin` | 打开 Web 管理控制台时的登入密码 |
| **官方线上公开域名** | `https://lite.bigbob.asia/v1` | 绑定 Cloudflare 后的对外安全 API 基址 |
| **API 访问密钥 (Key)** | `qg_live_42adacf1b759ee4e6e8a7ea99f9eb350` | 网关对外 API 调用的 Bearer 授权密钥 |
| **Qoder 账号 1 (liuzhuyun)** | `019f1692-e593-738d-ae1b-2b4be08e4e97` | Teams 账号 |
| **Qoder 账号 2 (风思黏)** | `019f06ed-573c-7587-9a95-0ae424e45970` | PAT: `pt-1MbShtP4W20vTvPcZGtRbcWN_01a0c835-2e4f-79f9-8954-1de1cc43cd84` |
| **上游官方基址** | `https://qoder.com.cn` | 国内版 Qoder 服务接口 |
| **本地备份开发目录** | `D:\AI\QoderGateway\` 与 `D:\AI\Dirty work gemini\Qoder代理\` | 本地工作区与脚本环境 |

---

## 2. 对话定位与业务背景

- **核心主题**：
  1. **QoderGateway 2API 项目开发与维护**：专门针对国内版 Qoder（`qoder.com.cn`）开发的 OpenAI 兼容协议转换网关。
  2. **双轨部署机制（本地 vs 云端服务器）**：
     - **本地方案**：Windows 环境通过 `start.bat` 一键在 `http://127.0.0.1:5050` 启动，开发测试自用。
     - **云端方案**：在已部署 9Router 的 Linux 服务器（`35.212.220.77`）上通过 Docker 运行，绑定域名 `lite.bigbob.asia` 提供长期稳定的 API 服务。
  3. **身份凭证流转**：通过国内版 Personal Access Token (PAT) 自动换取会话 Session / Bearer 鉴权，实现长效保活。
  4. **下游客户端集成**：适配 ZCode、Codex++、Cursor、NextChat 等第三方 AI 开发工具。

---

## 3. 核心机制与避坑经验

### 3.1 本地与服务器端点的生命周期切换
- **习惯记录**：当用户切到云端服务器运行（`lite.bigbob.asia`）后，**应主动停掉本地占用的 5050 端口**，避免重复请求或端口冲突。
- **本地关闭方法**：关闭 `start.bat` 弹出的终端窗口，或在 PowerShell 中执行：
  ```powershell
  Get-NetTCPConnection -LocalPort 5050 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```

### 3.2 `/v1/chat/completions` 与 `/v1/completions` 的区别
- **chat/completions**：标准的对话格式（包含 `messages: [{role: 'user', content: '...'}]`），是现代 IDE（如 Cursor、ZCode）和 Web 对话界面必须使用的端点。
- **completions**：旧版单文本补全格式（`prompt: "..."`），已被主流工具淘汰。网关重点支持并保证 `chat/completions` 的流式体验。

### 3.3 ZCode / Cursor 调用直连配置
1. **API 地址拼写**：Base URL 填写 `https://lite.bigbob.asia/v1`。
2. **API Key 填写**：直接使用 PAT 令牌 `qg_live_42adacf1b759ee4e6e8a7ea99f9eb350`。
3. **连通性实测命令**：
   ```bash
   curl -X POST "https://lite.bigbob.asia/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \
     -d '{"model":"kimi-k3","messages":[{"role":"user","content":"ping"}]}'
   ```

### 3.4 每日签到与积分中心 (Daily Check-in & Rewards)
- **业务规则**：每个 Qoder 账号每日可免费签到领取 +100 Credits 算力。
- **上游核心接口**：
  - 状态查询：`GET https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/status`
  - 领取奖励：`POST https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim`
  - 请求头：`Authorization: Bearer <token>`, `User-Agent: pi-provider-qoder`, `Cosy-Version: 1.0.1`, `Cosy-ClientType: 5`
  - 响应特征：200（领取成功 +100），409 `AlreadyExists`（今日已领取），401（Token 过期，网关自动刷新重试）。
- **网关内置端点**：
  - `GET /ui/checkin/status`：获取全部账号签到状态、连续签到天数、可用总算力。
  - `POST /ui/checkin/claim`：一键签到全部账号或单个账号。
- **自动守护机制**：
  - 开机自动补签（服务启动后 3 秒自动执行一次全量补领）。
  - 定时守护：每日北京时间 00:05 自动触发全量账号签到，永不漏领。
- **Web 控制台目录**：
  - 侧边栏专属目录：「每日签到」(`card_giftcard` 图标，带 `+100` 高亮角标)。
  - 4 项核心监控卡（今日签到进度、今日已领算力、账号池可用总算力、守护线程状态）+ 账号明细表 + 一键签到交互。

### 3.5 账号添加机制与避坑点（避免 "auth files not found"）
- **核心原因**：原「导入账号」按钮是读取本机客户端配置目录（`~/.config/qoder` 或 `AppData/qoder`）。当服务部署在云端 Linux VPS（Docker 容器）中时，容器内部并无安装图形桌面客户端，因此触发 `Local Qoder auth files (id/machine_id and user) not found` 错误。
- **解决方案与支持模式**：
  1. **PAT 令牌添加（推荐）**：在「账号池」或「控制台」点击「添加账号」，粘贴 Qoder 官网个人中心（Settings -> Personal Access Tokens）生成的 PAT，后端直接换取 Session 凭据并入库 SQLite。
  2. **批量导入（JSON）**：粘贴注册机导出的 `accounts.json`，一键导入多个账号。
  3. **弹窗指引优化**：「账号池」页面将原单向导入按钮升级为「+ 添加账号」模态弹窗，清晰划分三种添加模式，并在本机导入选项中明确提示云端部署限制。

### 3.6 账号单独调用与专属调度体系 (Solo Targeting & 3-Tier API Mode)
- **业务诉求**：用户拥有多账号（如团队共享号 `liuzhuyun` 4824 credits 与个人私有号 `风思黏` 300 credits）。既需要默认全账号轮询共享，又需要保护个人号不被常规请求消耗，同时在需要时能单独调用指定账号。
- **三种账号 API 调度模式 (`api_mode`)**：
  1. **全部调用 (`all`，默认)**：不设置时的默认行为，所有通用 API 请求均在此池中自动轮询负载均衡与故障重试。
  2. **专属单独调用 (`dedicated`)**：常规公共请求绝不消耗其算力；仅在请求显式单独指定该账号时才触发调度。
  3. **排除调用 (`disabled`)**：彻底不响应任何外部 API 请求，仅保留每日自动签到攒积分与令牌自动刷新保活。
### 3.7 API Key 多账号定向绑定与子池调度 (Multi-Account Key Binding & Sub-Pool Routing)
- **业务诉求**：用户希望将单个 API Key 绑定到任意多个指定账号（支持多选），而不是只能选 1 个或全部。
- **存储与格式兼容**：
  - 数据库字段依然沿用 `allowed_keys.account_uid TEXT`，存储多个账号 UID 时以英文逗号分隔（`uid1,uid2`），零数据库迁移成本且向下完全兼容旧的单 UID 绑定。
  - 后端配置通过 `parse_account_uids` 统一解析为 `account_uids: list[str]`。
- **子池闭环调度与重试**：
  - 当 API Key 绑定多个账号时，网关动态锁定目标账号为子集列表（`SUBSET POOL`）。
  - 会话循环调度和轮询严格限制在所选子集内；若某个账号遇到限额或临时报错，自动在所选子集内的其他可用账号间轮转重试，最大重试次数自适应为 `max(1, len(subset))`，绝不外溢到未授权账号。
  - 当未绑定账号（或绑定列表为空）时，自动回退到全局公共池默认轮询。
- **Web 控制台交互 (`MultiAccountSelect`)**：
  - 「API Key 管理」页面提供支持多选的交互浮层下拉组件，清晰展示各账号名称、额度、Plan 标签及 API 启用状态。
  - 支持快捷操作：一键「全选」、一键「清空（默认轮询）」以及单个复选框即时勾选，选定后自动保存生效。

### 3.8 企业用户 (Teams) 与 个人用户 (Personal) 识别及签到核实
- **核实结论**：Qoder 企业版/团队版（Teams）账号**完全支持每日签到**！
  - 底层调用官方端点 `POST /sash/api/v1/me/daily-check-in/claim` 实测返回 `HTTP 409 AlreadyExists`，证明该企业账号今日已由网关守护程序自动成功签到入账 +100 Credits。
  - 配额构成机制：`liuzhuyun` 的 4,822 credits 包含两部分：个人席位配额（`userQuota`，总计 3000，剩余 2970）+ 企业组织公共资源包（`orgResourcePackage`，剩余 1852），两者累加，完全享有每日签到福利。
- **后端自动分类识别**：
  - 接口端点：`/api/v2/quota/usage`
  - 识别逻辑：当返回 `userType == "teams"` 或存在 `orgResourcePackage` 时，自动识别为 `user_type: "teams"`, `plan: "Teams"`, `is_enterprise: True`；否则为 `user_type: "personal"`, `plan: "Personal"`, `is_enterprise: False`。
  - `/ui/accounts` 与 `/ui/checkin/status` 原生下发 `is_enterprise: bool`。
- **前端表头与视觉标识升级**：
  - 每日签到页表头：明确更新为 `用户类别 (企业/个人)`。
  - 账号池页表头：明确更新为 `用户类别 / 配额`。
  - 专属视觉徽章（`UserTypeBadge`）：
    - 🏢 企业用户 (Teams)：紫色专属立体徽章（`bg-purple-900/40 text-purple-300 border-purple-700/60`）
    - 👤 个人用户 (Personal)：蓝色专属立体徽章（`bg-blue-900/40 text-blue-300 border-blue-700/60`）
  - 在「每日签到列表」、「账号池列表」及「API Key 多选下拉弹窗」全面统一展示。

### 3.9 API 调用接入与可调用模型管理 (极简 QoderGate 原生设计)
- **业务诉求与极简重构**：
  - 彻底去除无用冗余组件：隐藏侧边栏「本地调试 (Playground)」功能，保持极简；删除“最佳实践”等无用说明大卡片，替换为直接可用的 Codex++ 接入面板。
  - 默认锁定云端生产 `https://lite.bigbob.asia/v1`，原生兼容标准 OpenAI Chat Completions。
  - 全面回归 QoderGate 原生 UI 风格：采用 `glass-card`、`border-hairline`、`text-ink`、柔和微质感配色。
- **全量模型实测战报与剔除规则**：
  - 针对网关预置的 15 款模型在生产环境发起真实压测（`POST /v1/chat/completions`）。
  - **14 款模型 100% 成功 (Status 200 OK)**：
    - `kimi-k3` (6.96s)
    - `kimi-k2.8` (3.92s)
    - `deepseek-v4-pro` (3.45s)
    - `deepseek-flash` (2.30s)
    - `qwen-3.8-max` (3.30s)
    - `qwen-3.8-flash` (3.21s)
    - `qwen-3.7-max` (3.20s)
    - `qwen-3.7-plus` (5.54s)
    - `qwen-3.7-flash` (8.09s)
    - `glm-5.3` (3.42s)
    - `glm-5.3-flash` (6.94s)
    - `glm-5.2` (3.33s)
    - `auto` (4.30s)
    - `lite` (2.09s)
  - **1 款模型失败剔除**：
    - `minimax-m2.7` / `mmodel`：上游直接报 `HTTP 502 Bad Gateway`（已从 `/v1/models` 及前端完全剔除，防止用户踩坑）。

### 3.10 API Key 专属账号绑定与零配置客户端直连体系
- **用户核心关切**：
  - API Key 支持单独分配给账号，客户端（Codex++、Cursor 等）在使用该 Key 时如何感知与生效？是否需要加 `@账号`？
- **网关底层与前端联动逻辑**：
  1. **优先级调度**：模型后缀 (`model@account`) > Header (`X-Account`) > Key 绑定账号 (`bound_accounts: list[str]`) > 全局公共池。
  2. **专属锁定模式（单个绑定账号）**：
     - 当 API Key 绑定了单个专属账号（例如企业号 `liuzhuyun` 或个人号 `风思黏`）：
     - **客户端零配置直连**：用户在 Codex++ / Cursor 中配置该 Key，模型名称只需填写纯净原生名（如 `kimi-k3`、`deepseek-v4-pro`），网关自动 100% 锁定至绑定的专属账号，**无需在模型名后追加 @账号后缀**！
     - 前端视觉高亮呈现：呈现绿色专属锁定横幅，展示绑定的企业/个人标签、账号名称、可用额度（如 `4,822 credits 独享`）。
  3. **子池或公共模式（未绑定特定账号）**：
     - 当 API Key 未绑定特定账号时，默认在所有已开启“全部调用”的账号池中自动智能轮询负载均衡。
     - 若使用该公共 Key 且想临时定向至某账号，可在模型后追加 `@账号名`（如 `kimi-k3@liuzhuyun`），网关实现精准穿透。
  4. **快捷交互支持**：
     - 在 API Key 列表中，支持单选/点击快速将某个 Key 载入下方 Codex++ 配置卡片；
     - 提供「复制全部模型名」（逗号分隔）、「一键复制 cURL 示例」、「显示/隐藏 Key 明文」功能。


---

## 4. Git 代码仓库与同步规范

- **GitHub 远端地址**：`https://github.com/saulgoodgirl/QoderGateway.git`
- **上游 Upstream 地址**：`https://github.com/bzym2/QoderGateway.git`
- **主分支**：`main`
- **同步要求**：功能迭代后必须同步提交至本地 Git 并推送到 GitHub 远端。

---

## 5. 用户偏好与协作习惯

1. **一键批处理**：本地使用时，优先使用 `start.bat` 快速调起，不让用户逐行敲 `uv run` 或激活虚拟环境。
2. **凭据安全记录**：明确记录当前的 PAT 令牌和对应的访问地址，有疑问时秒级提供对应配置项。
3. **云端优先保障**：线上环境要求高可用，配置修改后需同步验证 `lite.bigbob.asia` 连通性。
