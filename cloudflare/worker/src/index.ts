/**
 * Tablet Monitor API
 * Cloudflare Worker for tablet heartbeat monitoring
 */

export interface Env {
  DB: D1Database;
}

interface TabletData {
  device_id: string;
  device_name?: string;
  last_seen?: string;
  battery_level?: number;
  is_charging?: boolean;
  alert_sent?: boolean;
  alert_type?: string;
  alert_timestamp?: string;
  last_battery_alert_level?: number;
  status?: string;
}

interface AlertData {
  device_id: string;
  alert_type: string;
  message?: string;
  battery_level?: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message, success: false }, status);
}

// Parse charging state from various formats (MacroDroid sends "On"/"Off" strings)
function parseChargingState(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'on' || lower === 'true' || lower === '1';
  }
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // POST /api/heartbeat - Update tablet state (called by MacroDroid directly)
      // Hybrid approach: stores data AND triggers n8n for critical events
      if (path === '/api/heartbeat' && request.method === 'POST') {
        const data = await request.json() as TabletData;

        if (!data.device_id) {
          return errorResponse('device_id is required');
        }

        const now = new Date().toISOString();
        const isCharging = parseChargingState(data.is_charging) ? 1 : 0;
        const batteryLevel = data.battery_level ?? 100;

        // Step 1: Read current state (to save as previous and detect changes)
        const current = await env.DB.prepare(`
          SELECT is_charging, battery_level, last_battery_alert_level, alert_sent, device_name
          FROM tablets WHERE device_id = ?
        `).bind(data.device_id).first<{
          is_charging: number;
          battery_level: number;
          last_battery_alert_level: number;
          alert_sent: number;
          device_name: string;
        }>();

        if (!current) {
          return errorResponse('Device not found', 404);
        }

        // Step 2: Detect critical events that need immediate alert
        let criticalEvent: string | null = null;

        // Power lost: was charging, now not charging
        if (current.is_charging === 1 && isCharging === 0) {
          criticalEvent = 'power_lost';
        }
        // Critical battery: below 5%, not charging, haven't alerted at this level
        else if (batteryLevel < 5 && isCharging === 0 && current.last_battery_alert_level > 5) {
          criticalEvent = 'critical_battery';
        }

        // Step 3: Update D1 with new values, storing previous state
        const result = await env.DB.prepare(`
          UPDATE tablets SET
            previous_is_charging = ?,
            previous_battery_level = ?,
            last_seen = ?,
            battery_level = ?,
            is_charging = ?,
            status = 'online',
            updated_at = CURRENT_TIMESTAMP
          WHERE device_id = ?
        `).bind(
          current.is_charging,
          current.battery_level,
          now,
          batteryLevel,
          isCharging,
          data.device_id
        ).run();

        // Step 4: If critical event and not already alerted, trigger n8n webhook
        let webhookTriggered = false;
        if (criticalEvent && current.alert_sent === 0) {
          try {
            await fetch('https://agent.binatrix.io/webhook/tablet-critical-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                device_id: data.device_id,
                device_name: current.device_name,
                alert_type: criticalEvent,
                battery_level: batteryLevel,
                is_charging: isCharging,
                timestamp: now,
              }),
            });
            webhookTriggered = true;
          } catch (e) {
            console.error('Failed to trigger n8n webhook:', e);
          }
        }

        return jsonResponse({
          success: true,
          changes: result.meta.changes,
          device_id: data.device_id,
          critical_event: criticalEvent,
          webhook_triggered: webhookTriggered,
        });
      }

      // POST /api/alert - Log alert to history (called by n8n)
      if (path === '/api/alert' && request.method === 'POST') {
        const data = await request.json() as AlertData;

        if (!data.device_id || !data.alert_type) {
          return errorResponse('device_id and alert_type are required');
        }

        await env.DB.prepare(`
          INSERT INTO alert_history (device_id, alert_type, message, battery_level)
          VALUES (?, ?, ?, ?)
        `).bind(
          data.device_id,
          data.alert_type,
          data.message || null,
          data.battery_level ?? null
        ).run();

        return jsonResponse({ success: true });
      }

      // GET /api/tablets - Get all tablets
      if (path === '/api/tablets' && request.method === 'GET') {
        const result = await env.DB.prepare(`
          SELECT * FROM tablets ORDER BY device_name
        `).all();

        return jsonResponse(result.results);
      }

      // GET /api/tablets/:id - Get single tablet
      const tabletMatch = path.match(/^\/api\/tablets\/(.+)$/);
      if (tabletMatch && request.method === 'GET') {
        const deviceId = decodeURIComponent(tabletMatch[1]);
        const result = await env.DB.prepare(`
          SELECT * FROM tablets WHERE device_id = ?
        `).bind(deviceId).first();

        if (!result) {
          return errorResponse('Tablet not found', 404);
        }

        return jsonResponse(result);
      }

      // GET /api/alerts - Get alert history
      if (path === '/api/alerts' && request.method === 'GET') {
        const limit = url.searchParams.get('limit') || '50';
        const deviceId = url.searchParams.get('device_id');

        let query = `
          SELECT ah.*, t.device_name
          FROM alert_history ah
          LEFT JOIN tablets t ON ah.device_id = t.device_id
        `;

        if (deviceId) {
          query += ` WHERE ah.device_id = ?`;
          query += ` ORDER BY ah.created_at DESC LIMIT ?`;
          const result = await env.DB.prepare(query).bind(deviceId, parseInt(limit)).all();
          return jsonResponse(result.results);
        } else {
          query += ` ORDER BY ah.created_at DESC LIMIT ?`;
          const result = await env.DB.prepare(query).bind(parseInt(limit)).all();
          return jsonResponse(result.results);
        }
      }

      // POST /api/tablets - Create new tablet
      if (path === '/api/tablets' && request.method === 'POST') {
        const data = await request.json() as TabletData;

        if (!data.device_id || !data.device_name) {
          return errorResponse('device_id and device_name are required');
        }

        await env.DB.prepare(`
          INSERT INTO tablets (device_id, device_name, status)
          VALUES (?, ?, 'offline')
        `).bind(data.device_id, data.device_name).run();

        return jsonResponse({ success: true, device_id: data.device_id });
      }

      // Health check
      if (path === '/health' || path === '/') {
        return jsonResponse({
          status: 'healthy',
          service: 'tablet-monitor-api',
          timestamp: new Date().toISOString(),
        });
      }

      return errorResponse('Not found', 404);

    } catch (error) {
      console.error('Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Internal server error',
        500
      );
    }
  },
};
