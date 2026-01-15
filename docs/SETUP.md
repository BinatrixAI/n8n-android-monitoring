# Setup Guide

Complete step-by-step guide to deploy the Android Tablet Monitoring system.

## Prerequisites

- [ ] Cloudflare account with Workers/D1 access
- [ ] n8n instance (cloud or self-hosted)
- [ ] Telegram account and bot token
- [ ] Android tablet with MacroDroid installed

## Step 1: Create Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., "Lotix Monitor")
4. Choose a username (e.g., `lotixco_bot`)
5. Save the **bot token** (format: `123456:ABC-DEF...`)
6. Create a group chat and add the bot
7. Get the **chat ID**:
   - Send a message to the group
   - Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find `chat.id` in the response (negative number for groups)

## Step 2: Deploy Cloudflare D1 Database

```bash
# Login to Cloudflare
wrangler login

# Create the database
wrangler d1 create tablet-monitor

# Note the database ID from output
# Example: efd09049-fc15-4692-b07b-bc3eb51af718

# Apply the schema
wrangler d1 execute tablet-monitor --file=cloudflare/d1/schema.sql --remote

# Verify
wrangler d1 execute tablet-monitor --command "SELECT * FROM tablets" --remote
```

## Step 3: Deploy Cloudflare Worker

1. Update `cloudflare/worker/wrangler.toml`:
```toml
name = "tablet-monitor-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "tablet-monitor"
database_id = "YOUR_DATABASE_ID"  # From Step 2
```

2. Deploy:
```bash
cd cloudflare/worker
npm install
wrangler deploy
```

3. Note the Worker URL (e.g., `https://tablet-monitor-api.YOUR_SUBDOMAIN.workers.dev`)

## Step 4: Import n8n Workflows

### Workflow 1: Tablet Heartbeat Listener

1. Open your n8n instance
2. Create new workflow
3. Import from `workflows/tablet-heartbeat-listener.json`
4. Update these nodes:
   - **All HTTP Request nodes**: Update Worker URL
   - **Send Telegram Alert**: Add Telegram credentials
5. Set workflow timezone to `Asia/Jerusalem` (Settings → Timezone)
6. Activate the workflow

### Workflow 2: Tablet Watchdog Timer

1. Create new workflow
2. Import from `workflows/tablet-watchdog-timer.json`
3. Update:
   - HTTP Request URL to your Worker
   - Telegram credentials
4. Activate the workflow

### Add Telegram Credentials

1. In n8n, go to Credentials
2. Create new Telegram API credential
3. Enter your bot token from Step 1
4. Update the `chat_id` in the Telegram nodes (-1003504666665 → your chat ID)

## Step 5: Configure MacroDroid

### Install MacroDroid
1. Install from Google Play Store
2. Grant all permissions
3. Disable battery optimization for MacroDroid

### Create Heartbeat Macro
1. Create new macro
2. Trigger: Time → Regular Interval → 5 minutes
3. Action: HTTP Request
   - Method: POST
   - URL: `https://agent.binatrix.io/webhook/tablet-heartbeat`
   - Content-Type: application/json
   - Body: (see macrodroid/templates/heartbeat.json)

### Create Power Lost Macro
1. Create new macro
2. Trigger: Battery/Power → Power Disconnected
3. Action: HTTP Request with power-lost.json body

### Create Low Battery Macro
1. Create new macro
2. Trigger: Battery Level → Decreases below 20%
3. Action: HTTP Request with low-battery.json body

## Step 6: Deploy Dashboard (Optional)

```bash
# Clone dashboard repo
git clone https://github.com/BinatrixAI/lotix-dashboard

# Install dependencies
cd lotix-dashboard
npm install

# Update API URL in lib/api.ts if needed
# const API_URL = 'https://YOUR-WORKER.workers.dev';

# Build
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy out --project-name=tablet-monitor --branch=main
```

## Step 7: Test the System

### Test 1: Manual Heartbeat
```bash
curl -X POST https://agent.binatrix.io/webhook/tablet-heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "tablet_001",
    "event_type": "heartbeat",
    "battery_level": 85,
    "is_charging": "on",
    "timestamp": "2026-01-15T10:00:00Z"
  }'
```

### Test 2: Power Lost Alert
```bash
curl -X POST https://agent.binatrix.io/webhook/tablet-heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "tablet_001",
    "event_type": "power_lost",
    "battery_level": 85,
    "is_charging": "off",
    "timestamp": "2026-01-15T10:00:00Z"
  }'
```

You should receive a Telegram message.

### Test 3: Dashboard
Open the dashboard URL and verify tablet status is displayed.

### Test 4: MacroDroid
1. Run the heartbeat macro manually
2. Check MacroDroid logs for 200 response
3. Verify n8n shows execution

## Verification Checklist

- [ ] D1 database created and schema applied
- [ ] Worker deployed and responding at /health
- [ ] n8n workflows imported and active
- [ ] Telegram bot sending messages
- [ ] MacroDroid sending heartbeats
- [ ] Dashboard showing tablet status

## Next Steps

1. Add custom domain to Cloudflare Pages (optional)
2. Add additional tablets with unique device_ids
3. Customize alert thresholds in n8n workflows
