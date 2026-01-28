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
- `critical_battery` - Battery crosses below 5% (not charging)
- `low_battery` - Battery crosses below 20% (not charging)
- `medium_battery` - Battery crosses below 50% (not charging)
- `recovery` - Device was offline, now sending heartbeat

### Non-Critical Events (5-min Polling)
- `connection_lost` - No heartbeat for 30+ minutes

### Battery Alert Logic (Threshold Crossing - January 2026)
Battery alerts use **threshold crossing detection**: compares `previous_battery_level` with current `battery_level` on each heartbeat.

| Previous | Current | Alert(s) Triggered |
|----------|---------|-------------------|
| 70% | 45% | `medium_battery` (crossed 50%) |
| 45% | 60% | None (battery increased) |
| 60% | 45% | `medium_battery` AGAIN (crossed 50% again) |
| 70% | 15% | BOTH `medium_battery` AND `low_battery` |
| 25% | 3% | BOTH `low_battery` AND `critical_battery` |

**Key benefit**: If battery recovers and drops again, alerts will fire again (unlike the old `last_battery_alert_level` approach which was one-way).

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
  "critical_events": ["medium_battery", "low_battery"],  // array, can have multiple
  "webhooks_triggered": 2                                 // count of webhooks sent
}
```

**Note**: Multiple events can trigger in one heartbeat (e.g., battery dropping from 70% to 15% crosses both 50% and 20% thresholds).

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
3. Battery threshold crossings (backup - Worker should catch these first):
   - `medium_battery` - Battery crossed below 50%
   - `low_battery` - Battery crossed below 20%
   - `critical_battery` - Battery crossed below 5%

## Alert Duplicate Prevention

**Important**: Different alert types use different mechanisms to prevent spam:

| Alert Type | Duplicate Prevention | Reset Condition |
|------------|---------------------|-----------------|
| `connection_lost` | `status !== 'offline'` | Device sends heartbeat (recovery) |
| `recovery` | `status === 'offline'` | Device goes offline again |
| Battery alerts | Threshold crossing detection | Automatic - alerts when battery crosses threshold again |

### Battery Threshold Crossing (January 2026)
Battery alerts use `previous_battery_level` vs `battery_level` comparison:
- Alert fires when: `previous >= threshold AND current < threshold`
- If battery recovers (goes up) and drops again, the threshold crossing happens again → alert fires again
- Multiple thresholds can be crossed in one heartbeat → multiple alerts sent
- No manual reset needed - the logic handles re-alerting automatically

**Note**: The `last_battery_alert_level` column still exists in D1 but is NO LONGER USED for alert decisions.

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
1. Battery alerts use THRESHOLD CROSSING: `previous_battery_level` must be >= threshold AND `battery_level` must be < threshold
2. Check if `previous_battery_level` was already below the threshold (no crossing = no alert)
3. Device must NOT be charging (`is_charging = 0`)
4. If stuck, manually set `previous_battery_level` higher than current to force a crossing on next heartbeat

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
  previous_battery_level = 100
WHERE device_id = 'tablet_001';

-- Force battery alert on next heartbeat (set previous higher than current)
UPDATE tablets SET
  previous_battery_level = battery_level + 10
WHERE device_id = 'tablet_001';

-- Example: Force 50% alert - set previous to 55%, current stays at actual level
UPDATE tablets SET
  previous_battery_level = 55
WHERE device_id = 'tablet_001' AND battery_level < 50;
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
