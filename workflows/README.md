# n8n Workflows

These JSON files can be imported directly into n8n.

## Importing Workflows

1. Open your n8n instance
2. Click "Add workflow" → "Import from file"
3. Select the JSON file
4. Update the following before activating:
   - Telegram credential reference
   - Chat ID in Telegram nodes
   - Worker API URL if using custom deployment

## Workflow 1: Tablet Heartbeat Listener

**File**: `tablet-heartbeat-listener.json`

**Purpose**: Receives webhook events from MacroDroid and processes them.

### Configuration Required

| Node | Setting | Value |
|------|---------|-------|
| Send Telegram Alert | chatId | Your Telegram chat ID |
| Send Telegram Alert | credentials | Your Telegram API credential |
| All HTTP Request nodes | url | Your Worker API URL |

### Alert Types Handled

- `power_lost` - Charger disconnected
- `low_battery` - Battery ≤ 20%
- `recovery` - Device back online
- `battery_drop` - Battery dropped 10%

## Workflow 2: Tablet Watchdog Timer

**File**: `tablet-watchdog-timer.json`

**Purpose**: Periodically checks for tablets that stopped sending heartbeats.

### Configuration Required

| Node | Setting | Value |
|------|---------|-------|
| Send Connection Lost Alert | chatId | Your Telegram chat ID |
| Send Connection Lost Alert | credentials | Your Telegram API credential |
| All HTTP Request nodes | url | Your Worker API URL |

### Timing

- Runs every 5 minutes
- Alerts after 35 minutes of silence
- Only alerts once (until device recovers)

## Current Live IDs

For reference, these are the workflow IDs in the production n8n instance:

- Tablet Heartbeat Listener: `PMxDyhROy6OOyB5d`
- Tablet Watchdog Timer: `BcKkOltuBjZQZazK`
