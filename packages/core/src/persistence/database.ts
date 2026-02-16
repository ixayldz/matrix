import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { EventEnvelope } from '../events/types.js';
import type { Message, Session } from '../types.js';

/**
 * Database configuration
 */
export interface DatabaseConfig {
  path?: string;
  inMemory?: boolean;
}

let warnedMissingSqlite = false;

/**
 * Run record
 */
export interface RunRecord {
  id: string;
  projectId: string;
  workingDirectory: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Checkpoint record
 */
export interface CheckpointRecord {
  id: string;
  runId: string;
  timestamp: string;
  state: string;
  data: Record<string, unknown>;
  description: string | null;
}

/**
 * Default database path
 */
function getDefaultDatabasePath(): string {
  const matrixDir = join(homedir(), '.matrix');
  if (!existsSync(matrixDir)) {
    mkdirSync(matrixDir, { recursive: true });
  }
  return join(matrixDir, 'matrix.db');
}

/**
 * Database manager class
 */
export class DatabaseManager {
  private db: Database.Database;
  private isInitialized = false;

  constructor(config: DatabaseConfig = {}) {
    const dbPath = config.inMemory ? ':memory:' : (config.path ?? getDefaultDatabasePath());
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Initialize database schema
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    const schemaPath = join(import.meta.dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Split and execute each statement
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      this.db.exec(statement + ';');
    }

    this.isInitialized = true;
  }

  /**
   * Create a new run
   */
  createRun(
    projectId: string,
    workingDirectory: string,
    config?: Record<string, unknown>
  ): RunRecord {
    this.ensureInitialized();

    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO runs (id, project_id, working_directory, status, created_at, updated_at, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, projectId, workingDirectory, 'running', now, now, config ? JSON.stringify(config) : null);

    return {
      id,
      projectId,
      workingDirectory,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      config: config ?? null,
      metadata: null,
    };
  }

  /**
   * Get run by ID
   */
  getRun(runId: string): RunRecord | null {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, project_id, working_directory, status, created_at, updated_at, completed_at, config_json, metadata_json
      FROM runs WHERE id = ?
    `);

    const row = stmt.get(runId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      projectId: row.project_id as string,
      workingDirectory: row.working_directory as string,
      status: row.status as RunRecord['status'],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: row.completed_at as string | null,
      config: row.config_json ? JSON.parse(row.config_json as string) : null,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : null,
    };
  }

  /**
   * Update run status
   */
  updateRunStatus(
    runId: string,
    status: RunRecord['status'],
    metadata?: Record<string, unknown>
  ): void {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const completedAt = status !== 'running' ? now : null;

    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = ?, updated_at = ?, completed_at = ?, metadata_json = ?
      WHERE id = ?
    `);

    stmt.run(runId, status, now, completedAt, metadata ? JSON.stringify(metadata) : null);
  }

  /**
   * List runs
   */
  listRuns(limit = 50, offset = 0): RunRecord[] {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, project_id, working_directory, status, created_at, updated_at, completed_at, config_json, metadata_json
      FROM runs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(limit, offset) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      workingDirectory: row.working_directory as string,
      status: row.status as RunRecord['status'],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: row.completed_at as string | null,
      config: row.config_json ? JSON.parse(row.config_json as string) : null,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : null,
    }));
  }

  /**
   * Save event to database
   */
  saveEvent(event: EventEnvelope): void {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      INSERT INTO events (id, run_id, event_version, timestamp, state, actor, type, correlation_id, payload_json, redaction_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.eventId,
      event.runId,
      event.eventVersion,
      event.timestamp,
      event.state,
      event.actor,
      event.type,
      event.correlationId,
      JSON.stringify(event.payload),
      event.redactionLevel
    );
  }

  /**
   * Get events for a run
   */
  getEvents(runId: string, limit = 1000): EventEnvelope[] {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE run_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    const rows = stmt.all(runId, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      eventVersion: row.event_version as 'v1',
      runId: row.run_id as string,
      eventId: row.id as string,
      timestamp: row.timestamp as string,
      state: row.state as EventEnvelope['state'],
      actor: row.actor as EventEnvelope['actor'],
      type: row.type as EventEnvelope['type'],
      correlationId: row.correlation_id as string,
      payload: JSON.parse(row.payload_json as string),
      redactionLevel: row.redaction_level as EventEnvelope['redactionLevel'],
    }));
  }

  /**
   * Save checkpoint
   */
  saveCheckpoint(
    runId: string,
    state: string,
    data: Record<string, unknown>,
    description?: string
  ): CheckpointRecord {
    this.ensureInitialized();

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, run_id, timestamp, state, data_json, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, runId, timestamp, state, JSON.stringify(data), description ?? null);

    return {
      id,
      runId,
      timestamp,
      state,
      data,
      description: description ?? null,
    };
  }

  /**
   * Get latest checkpoint for a run
   */
  getLatestCheckpoint(runId: string): CheckpointRecord | null {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, run_id, timestamp, state, data_json, description
      FROM checkpoints
      WHERE run_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const row = stmt.get(runId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      runId: row.run_id as string,
      timestamp: row.timestamp as string,
      state: row.state as string,
      data: JSON.parse(row.data_json as string),
      description: row.description as string | null,
    };
  }

  /**
   * List checkpoints for a run
   */
  listCheckpoints(runId: string): CheckpointRecord[] {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, run_id, timestamp, state, data_json, description
      FROM checkpoints
      WHERE run_id = ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(runId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      runId: row.run_id as string,
      timestamp: row.timestamp as string,
      state: row.state as string,
      data: JSON.parse(row.data_json as string),
      description: row.description as string | null,
    }));
  }

  /**
   * Create or update session
   */
  saveSession(runId: string, messages: Message[], context: Record<string, unknown>): Session {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const id = uuidv4();

    // Check if session exists
    const existingStmt = this.db.prepare('SELECT id FROM sessions WHERE run_id = ?');
    const existing = existingStmt.get(runId) as Record<string, unknown> | undefined;

    if (existing) {
      const updateStmt = this.db.prepare(`
        UPDATE sessions
        SET updated_at = ?, messages_json = ?, context_json = ?
        WHERE run_id = ?
      `);
      updateStmt.run(now, JSON.stringify(messages), JSON.stringify(context), runId);

      return {
        id: existing.id as string,
        runId,
        createdAt: '', // We don't have this info
        updatedAt: now,
        messages,
        context,
      };
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO sessions (id, run_id, created_at, updated_at, messages_json, context_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(id, runId, now, now, JSON.stringify(messages), JSON.stringify(context));

    return {
      id,
      runId,
      createdAt: now,
      updatedAt: now,
      messages,
      context,
    };
  }

  /**
   * Get session for a run
   */
  getSession(runId: string): Session | null {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, run_id, created_at, updated_at, messages_json, context_json
      FROM sessions
      WHERE run_id = ?
    `);

    const row = stmt.get(runId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      runId: row.run_id as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      messages: JSON.parse(row.messages_json as string),
      context: JSON.parse(row.context_json as string),
    };
  }

  /**
   * Delete a run and all associated data
   */
  deleteRun(runId: string): void {
    this.ensureInitialized();

    const stmt = this.db.prepare('DELETE FROM runs WHERE id = ?');
    stmt.run(runId);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get raw database instance (for advanced operations)
   */
  getRawDb(): Database.Database {
    return this.db;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }
}

/**
 * Fallback in-memory database manager used when native sqlite bindings are unavailable.
 */
class NoopDatabaseManager {
  private runs = new Map<string, RunRecord>();
  private events: EventEnvelope[] = [];
  private checkpoints: CheckpointRecord[] = [];
  private sessions = new Map<string, Session>();

  initialize(): void {
    // no-op
  }

  createRun(
    projectId: string,
    workingDirectory: string,
    config?: Record<string, unknown>
  ): RunRecord {
    const id = uuidv4();
    const now = new Date().toISOString();
    const record: RunRecord = {
      id,
      projectId,
      workingDirectory,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      config: config ?? null,
      metadata: null,
    };
    this.runs.set(id, record);
    return record;
  }

  getRun(runId: string): RunRecord | null {
    return this.runs.get(runId) ?? null;
  }

  updateRunStatus(
    runId: string,
    status: RunRecord['status'],
    metadata?: Record<string, unknown>
  ): void {
    const record = this.runs.get(runId);
    if (!record) {
      return;
    }
    const now = new Date().toISOString();
    this.runs.set(runId, {
      ...record,
      status,
      updatedAt: now,
      completedAt: status === 'running' ? null : now,
      metadata: metadata ?? null,
    });
  }

  listRuns(): RunRecord[] {
    return Array.from(this.runs.values());
  }

  saveEvent(event: EventEnvelope): void {
    this.events.push(event);
  }

  getEvents(runId: string): EventEnvelope[] {
    return this.events.filter((event) => event.runId === runId);
  }

  saveCheckpoint(
    runId: string,
    state: string,
    data: Record<string, unknown>,
    description?: string
  ): CheckpointRecord {
    const checkpoint: CheckpointRecord = {
      id: uuidv4(),
      runId,
      timestamp: new Date().toISOString(),
      state,
      data,
      description: description ?? null,
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  getLatestCheckpoint(runId: string): CheckpointRecord | null {
    const runCheckpoints = this.checkpoints
      .filter((checkpoint) => checkpoint.runId === runId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return runCheckpoints[0] ?? null;
  }

  listCheckpoints(runId: string): CheckpointRecord[] {
    return this.checkpoints
      .filter((checkpoint) => checkpoint.runId === runId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  saveSession(runId: string, messages: Message[], context: Record<string, unknown>): Session {
    const existing = this.sessions.get(runId);
    const now = new Date().toISOString();
    const session: Session = {
      id: existing?.id ?? uuidv4(),
      runId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
      context,
    };
    this.sessions.set(runId, session);
    return session;
  }

  getSession(runId: string): Session | null {
    return this.sessions.get(runId) ?? null;
  }

  deleteRun(runId: string): void {
    this.runs.delete(runId);
    this.events = this.events.filter((event) => event.runId !== runId);
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.runId !== runId);
    this.sessions.delete(runId);
  }

  close(): void {
    // no-op
  }

  getRawDb(): never {
    throw new Error('Raw DB access is unavailable in noop database mode.');
  }
}

/**
 * Create a database manager instance
 */
export function createDatabaseManager(config?: DatabaseConfig): DatabaseManager {
  try {
    const manager = new DatabaseManager(config);
    manager.initialize();
    return manager;
  } catch {
    if (!warnedMissingSqlite) {
      warnedMissingSqlite = true;
      console.warn('SQLite unavailable. Using in-memory database manager fallback.');
    }
    return new NoopDatabaseManager() as unknown as DatabaseManager;
  }
}
