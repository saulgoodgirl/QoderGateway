# Authentication

GITIT employs a two-layer security model that completely isolates administrative controls from client-facing API consumption.

## Layer 1: Admin Console Token (`X-Gateway-Token`)

Controls access to all `/ui/*` management endpoints:
- Dashboard status and cluster health
- Multi-provider account pool management
- Autonomous check-in and claiming controls
- API key generation and sub-pool bindings
- System logs

Configure in `.env`:
```env
QODER_ADMIN_PASSWORD=your-secure-password
```

## Layer 2: External Client Bearer Keys

Clients authenticate using standard Bearer tokens:

```http
Authorization: Bearer <qg_live_xxx>
```

### Sub-Pool Binding
Each API key can either:
- Dispatch requests across the entire account pool (default).
- Bind exclusively to a dedicated upstream account for isolated quota consumption.
