# Android Tablet Monitoring - Complete AI Context

## System Summary

**Purpose**: Monitor Android tablets at physical locations, send Telegram alerts for power loss, low battery, and connection issues.

**Architecture**: Hybrid approach (v2.0 - January 2026)
- **Data Path**: MacroDroid → Worker API → D1 (always stores data first)
- **Critical Alerts**: Worker detects & triggers n8n webhook immediately
- **Non-Critical Alerts**: n8n polls D1 every 5 minutes

**Components**:
1. **MacroDroid** (on tablet) - Sends HTTP POST to Worker API
2. **Cloudflare Worker** - Stores data in D1, triggers n8n for critical events
3. **Cloudflare D1** - SQLite database storing tablet state
4. **n8n** - Handles alerts (webhook for critical, scheduled for non-critical)
5. **Dashboard** - Next.js UI showing status

## Quick Reference

### URLs
```
Dashboard:         https://lotix.binatrix.net (Clerk auth required)
Worker API:        https://tablet-monitor-api.binatrix.workers.dev
MacroDroid Target: https://tablet-monitor-api.binatrix.workers.dev/api/heartbeat
```

### IDs
```
Cloudflare Account:       85b301e09d399a4c5cc4933d0ac9fd03
D1 Database ID:           efd09049-fc15-4692-b07b-bc3eb51af718
n8n Critical Alert WF:    rTkKlTGn0TCexCV0
n8n Monitor (5-min) WF:   EweQnfB7cW4fZoTX
Telegram Chat ID:         -1003504666665
```

### Deprecated (disabled)
```
n8n Heartbeat WF:  PMxDyhROy6OOyB5d  [DISABLED]
n8n Watchdog WF:   BcKkOltuBjZQZazK  [DISABLED]
Old Webhook:       https://agent.binatrix.io/webhook/tablet-heartbeat (DO NOT USE)
```

## Architecture v2.0 (Hybrid)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Tablet    │────▶│  Cloudflare │────▶│     D1      │
│ (MacroDroid)│     │   Worker    │     │  Database   │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                   │
                    critical events     every 5 min
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    n8n      │     │    n8n      │
                    │  (webhook)  │     │ (scheduled) │
                    └──────┬──────┘     └──────┬──────┘
                           │                   │
                           └───────┬───────────┘
                                   ▼
                            ┌─────────────┐
                            │  Telegram   │
                            └─────────────┘
```

### Critical Events (Immediate via Webhook)
- `power_lost` - Charger disconnected (is_charging: 1 → 0)
- `critical_battery` - Battery < 5% and not charging
- `recovery` - Device was offline, now sending heartbeat

### Non-Critical Events (5-min Polling)
- `connection_lost` - No heartbeat for 30+ minutes
- `medium_battery` - Battery < 50%
- `low_battery` - Battery < 20%

## MacroDroid Configuration

### Webhook URL (NEW - use this)
```
https://tablet-monitor-api.binatrix.workers.dev/api/heartbeat
```

### HTTP Request Settings
- Method: POST
- Content-Type: application/json
- Block Cookies: OFF

### Heartbeat JSON (every 5 minutes)
```json
{
  "device_id": "tablet_001",
  "battery_level": {battery},
  "is_charging": {power}
}
```

**Note**: No `event_type` needed - Worker auto-detects critical events by comparing state.

### Magic Text Variables
| Variable | Returns | Example |
|----------|---------|---------|
| `{battery}` | Battery % (number) | `80` |
| `{power}` | Boolean | `true` or `false` |

**Important**: Use `{power}` which returns boolean, not `"{power}"` string.

## Cloudflare Worker API

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/heartbeat` | Update tablet state (MacroDroid calls this) |
| POST | `/api/alert` | Log alert to history (n8n calls this) |
| GET | `/api/tablets` | List all tablets |
| GET | `/api/tablets/:id` | Get single tablet |
| GET | `/api/alerts` | Get alert history |
| POST | `/api/tablets` | Create new tablet |

### POST /api/heartbeat Response
```json
{
  "success": true,
  "changes": 1,
  "device_id": "tablet_001",
  "critical_event": "power_lost",  // or null
  "webhook_triggered": true        // if n8n was called
}
```

### D1 Database Schema

```sql
CREATE TABLE tablets (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  last_seen TEXT,
  battery_level INTEGER DEFAULT 100,
  is_charging INTEGER DEFAULT 1,
  previous_is_charging INTEGER DEFAULT 1,      -- For power_lost detection
  previous_battery_level INTEGER DEFAULT 100,  -- For battery_drop detection
  alert_sent INTEGER DEFAULT 0,
  alert_type TEXT DEFAULT 'none',
  alert_timestamp TEXT,
  last_battery_alert_level INTEGER DEFAULT 100,
  status TEXT DEFAULT 'offline',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT,
  battery_level INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## n8n Workflows

### Tablet Critical Alert Handler (rTkKlTGn0TCexCV0)
**Trigger**: Webhook at `/webhook/tablet-critical-alert`
**Called by**: Worker API when critical event detected

```
Webhook → Format Alert Message → Send Telegram → Log to D1
```

### Tablet Monitor 5-min (EweQnfB7cW4fZoTX)
**Trigger**: Schedule every 5 minutes

```
Schedule → Read All Tablets → Detect Alerts → IF Alert? → Telegram → Update D1
```

**Detects** (in priority order):
1. `connection_lost` - No heartbeat for 30+ minutes (uses `status !== 'offline'` to prevent duplicates)
2. `recovery` - Was offline, now online with recent heartbeat
3. `critical_battery` - Battery < 5% (uses `last_battery_alert_level > 5`)
4. `low_battery` - Battery < 20% (uses `last_battery_alert_level > 20`)
5. `medium_battery` - Battery < 50% (uses `last_battery_alert_level > 50`)

## Alert Duplicate Prevention

**Important**: Different alert types use different mechanisms to prevent spam:

| Alert Type | Duplicate Prevention | Reset Condition |
|------------|---------------------|-----------------|
| `connection_lost` | `status !== 'offline'` | Device sends heartbeat (recovery) |
| `recovery` | `status === 'offline'` | Device goes offline again |
| Battery alerts | `last_battery_alert_level > threshold` | Charging + battery >= 50%, or recovery |

**Note**: Battery alerts do NOT check `alert_sent` flag - they only use `last_battery_alert_level`. This allows battery alerts to fire even if a connection_lost alert was previously sent.

## Timezone Configuration

| Component | Timezone | Format |
|-----------|----------|--------|
| MacroDroid | N/A | Just sends battery/charging state |
| Worker API | UTC | `new Date().toISOString()` |
| n8n Alert Messages | Asia/Jerusalem | DD/MM, HH:MM (24h) |
| D1 Database | UTC | CURRENT_TIMESTAMP |
| Dashboard Display | Asia/Jerusalem | DD/MM, HH:MM (24h) |

## Troubleshooting

### No Critical Alerts Received
1. Check Worker response includes `"webhook_triggered": true`
2. Verify n8n Critical Alert workflow is active
3. For `power_lost`/`critical_battery`: Check `alert_sent` flag (should be 0)

### No Battery Alerts (50%, 20%, 5%)
1. Check `last_battery_alert_level` in D1 - must be > threshold
2. Battery alerts are INDEPENDENT of `alert_sent` flag
3. Device must NOT be charging (`is_charging = 0`)

### No Connection Lost Alert
1. Check `status` field - must NOT be 'offline'
2. Check `last_seen` - must be 30+ minutes ago
3. Connection_lost is INDEPENDENT of `alert_sent` flag

### Tablet Shows Offline But Is Sending
1. Check D1 `last_seen` is updating
2. Verify 5-min monitor workflow is running
3. Check if `status` is stuck - run recovery detection

### Reset Tablet Alert State
```sql
-- Full reset (for testing)
UPDATE tablets SET
  alert_sent = 0,
  status = 'online',
  last_battery_alert_level = 100
WHERE device_id = 'tablet_001';

-- Reset only battery threshold (keep connection status)
UPDATE tablets SET
  last_battery_alert_level = 100
WHERE device_id = 'tablet_001';
```

## Adding New Tablet

1. **Create tablet in D1**:
```sql
INSERT INTO tablets (device_id, device_name, status)
VALUES ('tablet_002', 'Kitchen Tablet', 'offline');
```

2. **Configure MacroDroid** with:
   - URL: `https://tablet-monitor-api.binatrix.workers.dev/api/heartbeat`
   - device_id: `tablet_002`

3. **Test** by triggering a heartbeat

## File Locations

```
cloudflare/worker/src/index.ts  - Worker API code
cloudflare/worker/wrangler.toml - Worker config
```

## Related Repos

- **lotix-dashboard**: Next.js 16 dashboard UI with Clerk authentication, deployed to Cloudflare Workers
- **n8n-catalog**: Index of all n8n automations
