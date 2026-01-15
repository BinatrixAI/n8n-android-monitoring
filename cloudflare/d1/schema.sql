-- Tablet Monitor D1 Schema
-- Database: tablet-monitor

CREATE TABLE IF NOT EXISTS tablets (
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

CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT,
  battery_level INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES tablets(device_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_alert_history_device ON alert_history(device_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);

-- Insert initial tablet
INSERT OR IGNORE INTO tablets (device_id, device_name, status)
VALUES ('tablet_001', 'Reception Tablet', 'offline');
