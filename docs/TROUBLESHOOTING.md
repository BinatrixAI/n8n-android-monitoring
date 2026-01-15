# Troubleshooting Guide

Common issues and their solutions for the Android Tablet Monitoring system.

## MacroDroid Issues

### HTTP 422 Error

**Symptom**: MacroDroid logs show 422 response code

**Cause**: Invalid JSON body, usually wrong variable syntax

**Solution**:
1. Use curly braces `{}` for variables, NOT square brackets `[]`
2. Check JSON syntax (no trailing commas)

✅ Correct:
```json
{"battery_level": {battery}}
```

❌ Wrong:
```json
{"battery_level": [battery]}
{"battery_level": {lv=battery}}
```

### No Requests Being Sent

**Symptom**: MacroDroid shows no logs, n8n shows no executions

**Causes & Solutions**:

1. **Battery optimization killing MacroDroid**
   - Settings → Apps → MacroDroid → Battery → Unrestricted
   - Disable "Adaptive Battery" for MacroDroid

2. **Macro not enabled**
   - Check macro toggle is ON in MacroDroid

3. **WiFi not connected**
   - Verify tablet has internet access
   - Check if macro has WiFi constraint

4. **Wrong URL**
   - Verify URL is exactly: `https://agent.binatrix.io/webhook/tablet-heartbeat`
   - No trailing slash

### MacroDroid Stops After Reboot

**Solution**: Enable "Run at device startup" in MacroDroid settings

---

## n8n Issues

### Workflow Not Triggering

**Symptom**: MacroDroid shows 200 but n8n has no executions

**Causes & Solutions**:

1. **Workflow not active**
   - Check workflow toggle is ON
   - Look for red indicator

2. **Wrong webhook path**
   - Verify webhook node path matches URL
   - Should be: `tablet-heartbeat`

3. **n8n server issue**
   - Check n8n logs
   - Restart n8n if needed

### IF Node Not Sending Alerts

**Symptom**: Events processed but no Telegram messages

**Cause**: IF node checking wrong data

**Solution**: Ensure IF node uses expression:
```
{{ $('Detect Event Type').first().json.should_send_alert }}
```
NOT just `{{ $json.should_send_alert }}` (which checks previous node output)

### Wrong Time in Telegram Messages

**Symptom**: Time shows 2 hours ahead of actual time

**Cause**: MacroDroid sends local time as UTC (with 'Z' suffix)

**Solution**: Format Alert Message node should use `new Date()`:
```javascript
const timestamp = new Date().toLocaleString('en-GB', {
  timeZone: 'Asia/Jerusalem',
  // ...
});
```

---

## Dashboard Issues

### Shows "NaNd ago"

**Symptom**: Last seen shows "NaNd ago" instead of time

**Cause**: Invalid timestamp format from MacroDroid

**Solution**: Check MacroDroid variables are resolving correctly

### Wrong Time (2 hours off)

**Symptom**: Dashboard shows 03:54 instead of 05:54

**Cause**: D1 timestamps don't have timezone suffix

**Solution**: `formatJerusalemTime()` must append 'Z':
```typescript
let utcString = dateString.replace(' ', 'T') + 'Z';
```

### Dashboard Shows Stale Data

**Symptom**: Data doesn't update

**Solutions**:
1. Check Worker API is responding: `curl https://YOUR-WORKER/api/tablets`
2. Check browser console for errors
3. Verify API_URL in lib/api.ts is correct

---

## Cloudflare Issues

### Worker Returns 500 Error

**Symptom**: All API calls fail with 500

**Causes & Solutions**:

1. **D1 binding not configured**
   - Check wrangler.toml has correct database_id
   - Redeploy worker

2. **Database schema issue**
   - Verify tables exist:
   ```bash
   wrangler d1 execute tablet-monitor --command "SELECT name FROM sqlite_master WHERE type='table'" --remote
   ```

### D1 Query Errors

**Symptom**: "no such table" errors

**Solution**: Re-apply schema:
```bash
wrangler d1 execute tablet-monitor --file=cloudflare/d1/schema.sql --remote
```

---

## Telegram Issues

### Bot Not Sending Messages

**Causes & Solutions**:

1. **Bot token invalid**
   - Regenerate token with BotFather
   - Update n8n credentials

2. **Wrong chat ID**
   - Get correct chat ID from getUpdates API
   - Group chat IDs are negative numbers

3. **Bot not in group**
   - Add bot to the Telegram group
   - Give bot permission to send messages

### Messages Delayed

**Cause**: Telegram rate limiting

**Solution**: No action needed, messages will be delivered

---

## Charging Status Issues

### Shows "Charging" When Not Plugged In

**Symptom**: Dashboard shows "(charging)" but tablet is on battery

**Cause**: MacroDroid sends `is_charging: "on"` or `"off"` as strings. JavaScript string `"off"` is truthy!

**Solution**: Extract Data node must explicitly check for true values:
```javascript
const isCharging = body.is_charging === true || body.is_charging === 'on' || body.is_charging === 1;
```

❌ Wrong: `is_charging: body.is_charging || false` (string "off" → truthy → true)
✅ Correct: Explicit check for "on"/true/1

---

## Alert Logic Issues

### Getting Duplicate Alerts

**Cause**: `alert_sent` not being set correctly

**Solution**: Check Detect Event Type node sets `alert_sent: true`

### Recovery Alert Not Sent

**Cause**: Logic for detecting "was offline" not working

**Solution**: Check these conditions in Detect Event Type:
```javascript
const wasOffline = currentState.status === 'offline' ||
                   currentState.alert_sent === 1 ||
                   currentState.alert_sent === true;
const isRecovery = wasOffline && eventType === 'heartbeat';
```

### Connection Lost Alert Not Sent

**Cause**: Watchdog conditions not met

**Solution**: Check in "Check for Silent Tablets" node:
- `last_seen` is over 35 minutes ago
- `alert_sent` is 0/false
- `status` is not already 'offline'

---

## Quick Diagnostics

### Check System Health

```bash
# 1. Test Worker API
curl https://tablet-monitor-api.binatrix.workers.dev/health

# 2. Check tablets in D1
wrangler d1 execute tablet-monitor --command "SELECT * FROM tablets" --remote

# 3. Check recent alerts
wrangler d1 execute tablet-monitor --command "SELECT * FROM alert_history ORDER BY created_at DESC LIMIT 5" --remote

# 4. Test webhook manually
curl -X POST https://agent.binatrix.io/webhook/tablet-heartbeat \
  -H "Content-Type: application/json" \
  -d '{"device_id":"tablet_001","event_type":"heartbeat","battery_level":99,"is_charging":"on","timestamp":"2026-01-15T10:00:00Z"}'
```

### Reset Tablet State

If tablet is stuck in alert state:
```bash
wrangler d1 execute tablet-monitor --command "UPDATE tablets SET alert_sent = 0, status = 'offline', alert_type = 'none' WHERE device_id = 'tablet_001'" --remote
```
