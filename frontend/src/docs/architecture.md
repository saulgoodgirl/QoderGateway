# Architecture & Routing Engine

GITIT is a high-performance multi-provider AI aggregation gateway engineered with Python FastAPI and React.

## Request Flow

```text
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
```

## Backend Modules

- `app.py`: Main application, `/v1` endpoints, `/ui` APIs, and cloud registrar defense.
- `accounts.py`: Account CRUD, failover logic, and targeted routing (`model@account`).
- `zcode.py`: ZCode AES credentials decryption and GLM stream bridging.
- `auth.py`: Qoder PAT exchange and session signature.
- `checkin.py`: Dual autonomous schedule daemons for daily claiming.
- `database.py`: Multi-provider SQLite persistence.
