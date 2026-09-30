# 架构与调度内核

GITIT 是一个面向多厂商的高性能 AI 聚合网关，采用轻量异步 Python (FastAPI) 内核与现代化前端控制台构建。

## 整体架构流转

```text
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
```

## 核心后端模块

| 模块 | 职责与技术实现 |
| :--- | :--- |
| `app.py` | FastAPI 应用程序总入口、统一端点路由、UI 管理接口、云端注册机防穿透拦截（`ENABLE_REGISTRAR=false`）。 |
| `accounts.py` | SQLite 账号持久化、多厂商凭据纳管、`model@account` 精准路由决策与故障自动熔断。 |
| `zcode.py` | 智谱 ZCode 凭据解密（AES-256-GCM）、GLM 全系列模型标准化适配、双向流式 SSE 协议转换。 |
| `auth.py` | Qoder Personal Access Token (PAT) 自动换票、国内版 Bearer 鉴权签名与额度同步。 |
| `checkin.py` | 双轨定时守护进程：10:00:05 Qoder 每日签到与 00:00:05 ZCode 1 亿 Token 自动申领。 |
| `database.py` | SQLite 数据库管理，包含 `accounts`（带 `provider` 标识）、`api_keys` 与 `settings`。 |

## 前端技术栈与双状态交互

前端控制台由 Vite + React + Tailwind CSS + GSAP 构建：
- **双状态图标系统**：采用 Material Symbols 可变字体，激活项采用实心填色（`FILL 1`），未激活项采用描边轮廓（`FILL 0`）。
- **静态交付输出**：构建产物统一输出至 `src/qoder2api/static`，由 FastAPI 直接提供生产级静态文件托管。
