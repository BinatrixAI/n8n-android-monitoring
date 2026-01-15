# Android Tablet Monitoring - Complete AI Context

## System Summary

**Purpose**: Monitor Android tablets at physical locations, send Telegram alerts for power loss, low battery, and connection issues.

**Components**:
1. **MacroDroid** (on tablet) - Sends HTTP webhooks
2. **n8n** - Processes webhooks, sends Telegram alerts
3. **Cloudflare Worker** - API for D1 database
4. **Cloudflare D1** - SQLite database storing tablet state
5. **Dashboard** - Next.js UI showing status

## Quick Reference

### URLs
```
Dashboard:    https://tablet-monitor.pages.dev
Worker API:   https://tablet-monitor-api.binatrix.workers.dev
n8n Webhook:  https://agent.binatrix.io/webhook/tablet-heartbeat
```

### IDs
```
Cloudflare Account:    85b301e09d399a4c5cc4933d0ac9fd03
D1 Database ID:        efd09049-fc15-4692-b07b-bc3eb51af718
n8n Heartbeat WF:      PMxDyhROy6OOyB5d
n8n Watchdog WF:       BcKkOltuBjZQZazK
Telegram Chat ID:      -1003504666665
```

## Data Flow

```
1. MacroDroid (Tablet)
   ↓ POST JSON to webhook
2. n8n Webhook (Tablet Heartbeat Listener)
   ↓ Extract data, detect event type
3. n8n → Worker API (POST /api/heartbeat)
   ↓ Update tablet state in D1
4. n8n → Telegram (if alert needed)
   ↓ Send formatted message
5. n8n → Worker API (POST /api/alert)
   ↓ Log alert to history
6. Dashboard reads from Worker API
```

## MacroDroid Configuration

### Critical: Variable Syntax
**Use curly braces `{}` for all MacroDroid variables, NOT square brackets `[]`**

### Webhook URL
```
https://agent.binatrix.io/webhook/tablet-heartbeat
```

### HTTP Request Settings
- Method: POST
- Content-Type: application/json
- Block Cookies: OFF

### Heartbeat JSON (every 5 minutes)
```json
{
"device_id": "tablet_001",
"event_type": "heartbeat",
"battery_level": {battery},
"is_charging": "{power}",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

### Power Lost JSON (trigger: Power Disconnected)
```json
{
"device_id": "tablet_001",
"event_type": "power_lost",
"battery_level": {battery},
"is_charging": "off",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

### Low Battery JSON (trigger: Battery <= 20%)
```json
{
"device_id": "tablet_001",
"event_type": "low_battery",
"battery_level": {battery},
"is_charging": "{power}",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

## MacroDroid Magic Text Reference

### Battery & Power
| Variable | Returns | Example |
|----------|---------|---------|
| `{battery}` | Battery % (number) | `80` |
| `{power}` | Charging state | `on` or `off` |

### Date & Time
| Variable | Returns | Example |
|----------|---------|---------|
| `{year}` | 4-digit year | `2026` |
| `{month_digit}` | Month number | `01` |
| `{dayofmonth}` | Day with leading zero | `15` |
| `{hour_0}` | Hour 24h with leading zero | `05` |
| `{minute}` | Minute | `54` |
| `{second}` | Second | `30` |

## n8n Workflow: Tablet Heartbeat Listener

**ID**: `PMxDyhROy6OOyB5d`

### Node Flow
```
Webhook → Extract Data → Read from D1 → Detect Event Type → Update D1 → IF Alert? → Format Message → Telegram → Log Alert
```

### Alert Types
| Event | Condition | Telegram Message |
|-------|-----------|------------------|
| `power_lost` | Power disconnected | "Power Supply Disconnected" |
| `low_battery` | Battery ≤ 20% | "Low Battery Warning" |
| `recovery` | Device back online after alert | "System Online" |
| `battery_drop` | Battery dropped 10% while not charging | "Battery Level Update" |

### Important: Time Formatting
The Format Alert Message node uses **current n8n server time**, NOT the MacroDroid timestamp:
```javascript
// Uses new Date() - n8n server time in Jerusalem timezone
const timestamp = new Date().toLocaleString('en-GB', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false
});
```

**Reason**: MacroDroid sends local time with UTC 'Z' suffix, causing 2-hour offset.

## n8n Workflow: Tablet Watchdog Timer

**ID**: `BcKkOltuBjZQZazK`

### Purpose
Runs every 5 minutes to detect tablets that stopped sending heartbeats.

### Alert Condition
- Tablet silent for 35+ minutes
- `alert_sent` is false/0
- Status is not already 'offline'

### Node Flow
```
Schedule (5min) → Read All Tablets from D1 → Check Silent Tablets → IF Any? → Format Alert → Telegram → Update Status to Offline
```

## Cloudflare Worker API

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/heartbeat` | Update tablet state |
| POST | `/api/alert` | Log alert to history |
| GET | `/api/tablets` | List all tablets |
| GET | `/api/tablets/:id` | Get single tablet |
| GET | `/api/alerts` | Get alert history |
| POST | `/api/tablets` | Create new tablet |

### D1 Database Schema

```sql
CREATE TABLE tablets (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  last_seen TEXT,
  battery_level INTEGER DEFAULT 100,
  is_charging INTEGER DEFAULT 1,
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

## Timezone Configuration

| Component | Timezone | Format |
|-----------|----------|--------|
| MacroDroid | Device local (Israel) | Formatted as UTC with 'Z' |
| n8n Alert Messages | Asia/Jerusalem | DD/MM, HH:MM (24h) |
| D1 Database | UTC | CURRENT_TIMESTAMP |
| Dashboard Display | Asia/Jerusalem | DD/MM, HH:MM (24h) |

**Critical**: D1 stores timestamps without timezone suffix. Dashboard must append 'Z' before parsing.

## Troubleshooting

### MacroDroid 422 Error
- Ensure using curly braces `{}` not square brackets `[]`
- Verify JSON has no syntax errors

### Dashboard Shows Wrong Time
- Check `formatJerusalemTime()` appends 'Z' to D1 timestamps
- D1 stores UTC, must convert to Jerusalem

### Telegram Shows Wrong Time
- n8n Format Alert Message node should use `new Date()`, not MacroDroid timestamp

### No Alerts Received
- Check MacroDroid webhook URL is exact
- Verify n8n workflow is active
- Check Telegram bot credentials

### Tablet Shows Offline But Is Sending
- Check if `alert_sent` got stuck at 1
- Recovery event should reset status

## Adding New Tablet

1. **Create tablet in D1**:
```sql
INSERT INTO tablets (device_id, device_name, status)
VALUES ('tablet_002', 'Kitchen Tablet', 'offline');
```

2. **Configure MacroDroid** with new `device_id`

3. **Test** by triggering a heartbeat
