# System Architecture

## Overview

The Android Tablet Monitoring system consists of five main components working together to provide real-time monitoring and alerting.

## Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                         TABLET SIDE                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    MacroDroid                             │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │  │
│  │  │  Heartbeat  │ │ Power Lost  │ │   Low Battery       │ │  │
│  │  │  (5 min)    │ │ (trigger)   │ │   (trigger)         │ │  │
│  │  └──────┬──────┘ └──────┬──────┘ └──────────┬──────────┘ │  │
│  │         │               │                    │            │  │
│  └─────────┼───────────────┼────────────────────┼────────────┘  │
│            │               │                    │               │
└────────────┼───────────────┼────────────────────┼───────────────┘
             │               │                    │
             └───────────────┼────────────────────┘
                             │ HTTP POST (JSON)
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                         n8n INSTANCE                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Tablet Heartbeat Listener (Workflow)            │  │
│  │                                                           │  │
│  │  Webhook → Extract → Read D1 → Detect → Update D1 → IF   │  │
│  │                                                      ↓    │  │
│  │                                    Format → Telegram → Log │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Tablet Watchdog Timer (Workflow)                │  │
│  │                                                           │  │
│  │  Schedule (5min) → Read All → Check Silent → IF → Alert  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
             │                              │
             │ HTTP (API calls)             │ Telegram Bot API
             ▼                              ▼
┌────────────────────────┐       ┌────────────────────────┐
│   Cloudflare Worker    │       │       Telegram         │
│   (tablet-monitor-api) │       │                        │
│                        │       │  Alert Messages        │
│  /api/heartbeat  POST  │       │  to Chat Group         │
│  /api/tablets    GET   │       │                        │
│  /api/alerts     GET   │       └────────────────────────┘
│  /api/alert      POST  │
└───────────┬────────────┘
            │ D1 Queries
            ▼
┌────────────────────────┐
│   Cloudflare D1        │
│   (tablet-monitor)     │
│                        │
│  tablets table         │
│  alert_history table   │
└───────────┬────────────┘
            │ HTTP GET
            ▼
┌────────────────────────┐
│   Dashboard            │
│   (Cloudflare Pages)   │
│                        │
│  Real-time status      │
│  Alert history         │
└────────────────────────┘
```

## Data Flows

### Flow 1: Heartbeat (Normal Operation)

```
1. MacroDroid timer triggers (every 5 min)
2. HTTP POST to n8n webhook with:
   - device_id, battery_level, is_charging, timestamp
3. n8n reads current device state from D1 (via Worker)
4. n8n updates device state in D1:
   - last_seen, battery_level, is_charging, status='online'
5. IF device was offline → send recovery alert to Telegram
6. Dashboard shows updated status on next refresh
```

### Flow 2: Power Lost Alert

```
1. Charger disconnected triggers MacroDroid
2. HTTP POST with event_type='power_lost'
3. n8n processes event, sets alert_sent=true
4. Telegram receives "Power Supply Disconnected" message
5. Alert logged to D1 alert_history
6. Dashboard shows last alert type
```

### Flow 3: Connection Lost (Watchdog)

```
1. n8n schedule triggers every 5 minutes
2. Reads all tablets from D1
3. Checks each tablet's last_seen timestamp
4. IF silent > 35 minutes AND alert_sent=false:
   - Send "Connection Lost" to Telegram
   - Update status='offline', alert_sent=true
```

### Flow 4: Recovery

```
1. Tablet comes back online, sends heartbeat
2. n8n detects: was offline → now sending heartbeat
3. Sends "System Online" to Telegram
4. Resets alert_sent=false, status='online'
```

## Database Schema

### tablets Table
| Column | Type | Description |
|--------|------|-------------|
| device_id | TEXT | Primary key (e.g., 'tablet_001') |
| device_name | TEXT | Display name |
| last_seen | TEXT | Last heartbeat timestamp |
| battery_level | INTEGER | 0-100 |
| is_charging | INTEGER | 0 or 1 |
| alert_sent | INTEGER | 0 or 1 |
| alert_type | TEXT | last alert type |
| status | TEXT | 'online' or 'offline' |

### alert_history Table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment PK |
| device_id | TEXT | Foreign key |
| alert_type | TEXT | Type of alert |
| message | TEXT | Full alert message |
| battery_level | INTEGER | Battery at alert time |
| created_at | TEXT | Timestamp |

## API Endpoints

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/heartbeat` | POST | n8n | Update tablet state |
| `/api/alert` | POST | n8n | Log alert to history |
| `/api/tablets` | GET | Dashboard, n8n | List all tablets |
| `/api/tablets/:id` | GET | n8n | Get single tablet |
| `/api/alerts` | GET | Dashboard | Get alert history |

## Timing

| Event | Interval | Threshold |
|-------|----------|-----------|
| Heartbeat | 5 minutes | - |
| Watchdog check | 5 minutes | - |
| Connection lost alert | - | 35 minutes silence |
| Dashboard refresh | 30 seconds | - |

## Security Considerations

1. **No authentication** on Worker API (internal use only)
2. Telegram bot token stored in n8n credentials
3. Cloudflare Account ID in repo is public identifier (not secret)
4. D1 database not directly accessible from internet
