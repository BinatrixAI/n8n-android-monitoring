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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // POST /api/heartbeat - Update tablet state (called by n8n)
      if (path === '/api/heartbeat' && request.method === 'POST') {
        const data = await request.json() as TabletData;

        if (!data.device_id) {
          return errorResponse('device_id is required');
        }

        // Update tablet state
        const result = await env.DB.prepare(`
          UPDATE tablets SET
            last_seen = ?,
            battery_level = ?,
            is_charging = ?,
            alert_sent = ?,
            alert_type = ?,
            alert_timestamp = ?,
            last_battery_alert_level = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE device_id = ?
        `).bind(
          data.last_seen || new Date().toISOString(),
          data.battery_level ?? 100,
          data.is_charging ? 1 : 0,
          data.alert_sent ? 1 : 0,
          data.alert_type || 'none',
          data.alert_timestamp || null,
          data.last_battery_alert_level ?? 100,
          data.status || 'online',
          data.device_id
        ).run();

        return jsonResponse({
          success: true,
          changes: result.meta.changes,
          device_id: data.device_id,
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
