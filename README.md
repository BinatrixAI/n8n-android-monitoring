# Android Tablet Monitoring System

Complete monitoring solution for Android tablets using MacroDroid, n8n workflows, Cloudflare Workers/D1, and Telegram alerts.

## System Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Android       │     │      n8n        │     │    Telegram     │
│   Tablet        │────▶│   Workflows     │────▶│    Alerts       │
│  (MacroDroid)   │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 │ HTTP API
                                 ▼
                        ┌─────────────────┐
                        │   Cloudflare    │
                        │   Worker API    │
                        └────────┬────────┘
                                 │
                                 │ SQL
                                 ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │   Cloudflare    │◀────│    Dashboard    │
                        │   D1 Database   │     │   (Next.js)     │
                        └─────────────────┘     └─────────────────┘
```

## Live URLs

| Service | URL |
|---------|-----|
| Dashboard | https://tablet-monitor.pages.dev |
| Worker API | https://tablet-monitor-api.binatrix.workers.dev |
| n8n Webhook | https://agent.binatrix.io/webhook/tablet-heartbeat |

## Features

- **Heartbeat Monitoring**: Tablet sends status every 5 minutes
- **Power Loss Alerts**: Instant notification when charger disconnected
- **Low Battery Alerts**: Warning at 20% battery
- **Connection Lost Alerts**: Notification after 35 minutes of silence
- **Recovery Alerts**: Notification when tablet comes back online
- **Dashboard**: Real-time status view with alert history

## Quick Start

### Prerequisites

- Android tablet with [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid) installed
- n8n instance (cloud or self-hosted)
- Cloudflare account with Workers/D1 access
- Telegram bot token

### 1. Deploy Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create tablet-monitor

# Apply schema
wrangler d1 execute tablet-monitor --file=cloudflare/d1/schema.sql --remote

# Deploy Worker
cd cloudflare/worker
npm install
wrangler deploy
```

### 2. Import n8n Workflows

Import these workflow files into your n8n instance:
- `workflows/tablet-heartbeat-listener.json`
- `workflows/tablet-watchdog-timer.json`

Update the Telegram credentials and activate both workflows.

### 3. Configure MacroDroid

Install the macros from `macrodroid/` on your tablet:
- **Tablet Heartbeat**: Runs every 5 minutes
- **Power Lost Alert**: Triggers when power disconnected
- **Low Battery Alert**: Triggers at 20% battery

### 4. Deploy Dashboard (Optional)

```bash
cd dashboard
npm install
npm run build
npx wrangler pages deploy out --project-name=tablet-monitor
```

Or use the existing dashboard at https://tablet-monitor.pages.dev

## Project Structure

```
n8n-android-monitoring/
├── README.md                 # This file
├── CLAUDE.md                 # AI context for quick understanding
├── workflows/                # n8n workflow exports
│   ├── tablet-heartbeat-listener.json
│   └── tablet-watchdog-timer.json
├── cloudflare/
│   ├── worker/               # API Worker source code
│   │   ├── src/index.ts
│   │   ├── wrangler.toml
│   │   └── package.json
│   └── d1/
│       └── schema.sql        # Database schema
├── macrodroid/
│   ├── README.md             # MacroDroid setup guide
│   └── templates/            # JSON body templates
└── docs/
    ├── ARCHITECTURE.md       # Detailed system design
    ├── SETUP.md              # Step-by-step setup guide
    └── TROUBLESHOOTING.md    # Common issues and fixes
```

## Configuration Values

```yaml
# Cloudflare
account_id: 85b301e09d399a4c5cc4933d0ac9fd03
d1_database_name: tablet-monitor
d1_database_id: efd09049-fc15-4692-b07b-bc3eb51af718
worker_name: tablet-monitor-api

# n8n Workflows
heartbeat_listener_id: PMxDyhROy6OOyB5d
watchdog_timer_id: BcKkOltuBjZQZazK

# Telegram
chat_id: -1003504666665
bot_name: @lotixco_bot

# Timezone
timezone: Asia/Jerusalem
date_format: DD/MM
time_format: 24h
```

## Related Repositories

- [lotix-dashboard](https://github.com/BinatrixAI/lotix-dashboard) - Next.js monitoring dashboard
- [n8n-catalog](https://github.com/BinatrixAI/n8n-catalog) - Index of all n8n automations

## License

MIT
