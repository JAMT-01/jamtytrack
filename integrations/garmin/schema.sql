-- Additive integration tables. Existing meals, habits, and settings are untouched.
CREATE TABLE IF NOT EXISTS garmin_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 session_cipher TEXT, pending_cipher TEXT,
 enabled INTEGER NOT NULL DEFAULT 0,
 since_day TEXT, last_sync_at TEXT, last_attempt_at TEXT,
 last_error TEXT, error_code TEXT,
 cooldown_until INTEGER NOT NULL DEFAULT 0,
 auth_window INTEGER NOT NULL DEFAULT 0, auth_count INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO garmin_connection(id) VALUES(1);
CREATE TABLE IF NOT EXISTS garmin_activities (
 activity_id TEXT PRIMARY KEY,
 started_at TEXT NOT NULL, day TEXT NOT NULL,
 distance_meters REAL NOT NULL CHECK(distance_meters>=0)
);
CREATE INDEX IF NOT EXISTS garmin_activities_day ON garmin_activities(day);
CREATE TABLE IF NOT EXISTS garmin_habit_days (
 habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
 day TEXT NOT NULL, entry_id TEXT,
 suppressed INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(habit_id,day)
);
