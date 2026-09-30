# Quickstart

This page explains how to get started with the GITIT Multi-Provider AI Aggregation Gateway, manage Qoder and ZCode account pools, and complete your first unified API request.

## Quick Overview

Follow these three steps:

- Start GITIT (cloud-hosted or locally).
- Manage multi-provider accounts (Qoder PATs, ZCode credentials) and API routing modes.
- Complete your first OpenAI-compatible API call or connect client IDEs.

## Installation & Startup

### Option 1: Cloud Deployment (Recommended)
If GITIT is deployed on Server A (`35.212.220.77`) with Cloudflare, access the console directly:

```text
https://lite.bigbob.asia/console
```

The unified API endpoint is:
```text
https://lite.bigbob.asia/v1
```

### Option 2: Local Deployment

Clone the repository and install dependencies:

```bash
git clone https://github.com/saulgoodgirl/QoderGateway.git
cd QoderGateway
uv sync
```

Launch with `start.bat` on Windows or run:

```powershell
uv run qoder2api
```

Web Console: `http://127.0.0.1:5050/console`

## Admin Password Configuration

The default gateway token is:

```text
admin
```

In production, change your admin password in `.env`:

```env
QODER_ADMIN_PASSWORD=your-strong-password
```

This token protects all `/ui/*` administrative endpoints.

## Multi-Provider Account Pool

GITIT natively unifies Qoder and Zhipu ZCode:

### 1. Adding Qoder Accounts
- Click **Add Account**, select **Qoder**, and enter your PAT (`pt-...`).
- Or use **Auto Import** in local mode to extract local Qoder sessions.

### 2. Adding ZCode Accounts
- Click **Add Account**, select **ZCode**, and enter your Zhipu API key or exported credentials.

### 3. API Routing Modes
- **All (General Pool)**: Participates in global load-balancing and auto-failover.
- **Dedicated**: Only called when explicitly specified via `model@account` syntax.
- **Disabled**: Excluded from API routing, while continuing to receive daily automated maintenance and claiming!

## Dual Autonomous Maintenance Daemons

- **Qoder Rewards**: 10:00:05 (UTC+8) claims **+100 Credits** daily for personal accounts (30 days validity).
- **ZCode Rewards**: 00:00:05 (UTC+8) claims **100,000,000 Tokens** daily.

## First API Request

```bash
curl https://lite.bigbob.asia/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350" \
  -d '{
    "model": "glm-4-flash",
    "messages": [{ "role": "user", "content": "Hello from GITIT" }],
    "stream": true
  }'
```

### Targeted Account Routing
```bash
-d '{
  "model": "kimi-k3@liuzhuyun",
  "messages": [{ "role": "user", "content": "Analyze this code" }]
}'
```
