# Account Pool & Autonomous Maintenance

GITIT unifies multiple upstream provider accounts (domestic Qoder, Zhipu ZCode, and custom OpenAI-compatible endpoints) into a single resilient routing pool with automatic failover.

## Supported Providers & Import Methods

| Provider | Credential | Method |
| :--- | :--- | :--- |
| **Qoder** | PAT (`pt-...`) / OAuth Session | Paste PAT in console or click Auto Import locally |
| **ZCode** | Zhipu API Key (`sk-...` / ID.Secret) | Enter API Key or extract from `%LOCALAPPDATA%\ZCode` |
| **Custom** | Standard Bearer Key + Base URL | Enter custom OpenAI endpoint |

## Three API Routing Modes

- **All (General Pool)**: Participates in global load-balancing and auto-failover.
- **Dedicated**: Excluded from generic calls; only triggered when requested via `model: "<model>@<account_name>"`.
- **Disabled**: Excluded from all API traffic, while continuing to receive daily autonomous check-in rewards!

## Dual Autonomous Maintenance Daemons

1. **Qoder 10:00:05 (UTC+8)**: Automatically claims **+100 Credits** daily for personal accounts (30 days validity). Enterprise Teams accounts are automatically bypassed.
2. **ZCode 00:00:05 (UTC+8)**: Automatically claims **100,000,000 Tokens** daily for ZCode accounts.
3. **Boot-time Reconciliation**: Runs 3 seconds after startup to claim any missed rewards immediately.

## Quota Tracking

- `provider`: Upstream provider identifier (`qoder`, `zcode`, `custom`).
- `quota`: Balance in Credits (Qoder) or Tokens (ZCode).
- `api_mode`: Routing configuration (`all`, `dedicated`, `disabled`).
