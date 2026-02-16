-- Matrix CLI Database Schema
-- Version: 1.0

-- Runs table: Store run metadata
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  config_json TEXT,
  metadata_json TEXT
);

-- Events table: Store event log
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  state TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  redaction_level TEXT NOT NULL DEFAULT 'none',
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for faster event queries by run
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

-- Checkpoints table: Store state snapshots
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  state TEXT NOT NULL,
  data_json TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for checkpoint queries
CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp ON checkpoints(timestamp);

-- Sessions table: Store session data
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  context_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);

-- Tool calls table: Store tool call history
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT,
  result_json TEXT,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for tool call queries
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

-- Diffs table: Store diff history
CREATE TABLE IF NOT EXISTS diffs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  file_path TEXT NOT NULL,
  hunks_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  applied_at TEXT,
  rolled_back_at TEXT,
  rollback_reason TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for diff queries
CREATE INDEX IF NOT EXISTS idx_diffs_run_id ON diffs(run_id);
CREATE INDEX IF NOT EXISTS idx_diffs_status ON diffs(status);
