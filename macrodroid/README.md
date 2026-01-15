# MacroDroid Configuration Guide

This guide explains how to configure MacroDroid on your Android tablet to send heartbeats and alerts.

## Prerequisites

1. Install [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid) from Google Play
2. Grant all requested permissions (especially battery optimization exemption)
3. Disable battery optimization for MacroDroid in Android settings

## Macro 1: Tablet Heartbeat

**Purpose**: Send status update every 5 minutes

### Trigger
- **Type**: Time / Day of Week
- **Interval**: Every 5 minutes

### Actions
- **Type**: HTTP Request (POST)
- **URL**: `https://agent.binatrix.io/webhook/tablet-heartbeat`
- **Content-Type**: `application/json`
- **Block Cookies**: OFF

### Body (Content)
```json
{
"device_id": "tablet_001",
"event_type": "heartbeat",
"battery_level": {battery},
"is_charging": "{power}",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

## Macro 2: Power Lost Alert

**Purpose**: Immediate alert when charger is disconnected

### Trigger
- **Type**: Battery / Power
- **Event**: Power Disconnected

### Actions
- **Type**: HTTP Request (POST)
- **URL**: `https://agent.binatrix.io/webhook/tablet-heartbeat`
- **Content-Type**: `application/json`

### Body (Content)
```json
{
"device_id": "tablet_001",
"event_type": "power_lost",
"battery_level": {battery},
"is_charging": "off",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

## Macro 3: Low Battery Alert

**Purpose**: Alert when battery drops below 20%

### Trigger
- **Type**: Battery Level
- **Condition**: Battery level decreases below 20%

### Actions
- **Type**: HTTP Request (POST)
- **URL**: `https://agent.binatrix.io/webhook/tablet-heartbeat`
- **Content-Type**: `application/json`

### Body (Content)
```json
{
"device_id": "tablet_001",
"event_type": "low_battery",
"battery_level": {battery},
"is_charging": "{power}",
"timestamp": "{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:{second}Z"
}
```

## Magic Text Variables

MacroDroid uses **curly braces `{}`** for variables. **DO NOT use square brackets `[]`**.

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{battery}` | Current battery percentage | `80` |
| `{power}` | Charging state | `on` or `off` |
| `{year}` | 4-digit year | `2026` |
| `{month_digit}` | Month as number | `01` |
| `{dayofmonth}` | Day with leading zero | `15` |
| `{hour_0}` | Hour (24h) with leading zero | `05` |
| `{minute}` | Minute | `30` |
| `{second}` | Second | `45` |

## Testing

### Check Macro Logs
1. Open MacroDroid
2. Go to Logs
3. Look for HTTP Request entries
4. Check response codes:
   - `200`: Success
   - `422`: Invalid JSON (check variable syntax)
   - `500`: Server error

### Manual Trigger
1. Open MacroDroid
2. Find your macro
3. Tap "Run" to test

### Verify in n8n
1. Open https://agent.binatrix.io
2. Go to Tablet Heartbeat Listener workflow
3. Check Executions for recent runs

## Troubleshooting

### 422 Error
**Cause**: Invalid JSON, usually wrong variable syntax

**Fix**: Ensure all variables use curly braces `{}`:
- ✅ Correct: `{battery}`
- ❌ Wrong: `[battery]` or `{lv=battery}`

### No Requests Being Sent
1. Check MacroDroid has battery optimization disabled
2. Verify WiFi is connected
3. Check macro is enabled (toggle ON)

### Timestamps Show Wrong Time
This is expected - MacroDroid sends local time as UTC. The n8n workflow uses server time instead for accurate timestamps.

## Multiple Tablets

For additional tablets:
1. Change `device_id` to a unique value (e.g., `tablet_002`)
2. Add the device in the D1 database
3. Use the same webhook URL

## Battery Optimization Tips

To prevent Android from killing MacroDroid:
1. Settings → Apps → MacroDroid → Battery → Unrestricted
2. Settings → Battery → Battery Saver → add MacroDroid exception
3. Some manufacturers (Samsung, Xiaomi) have additional settings
