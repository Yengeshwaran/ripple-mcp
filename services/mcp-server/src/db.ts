/**
 * db.ts — SQLite persistence layer for Ripple task management
 *
 * Uses Node.js built-in `node:sqlite` (Node >= 22.5.0 required).
 * Database path is configurable via RIPPLE_DB_PATH env var for tests.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Task shape ────────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  deadline: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

// ── DB singleton per process ──────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath =
    process.env["RIPPLE_DB_PATH"] ??
    path.resolve(process.cwd(), "data", "ripple.db");

  // Auto-create parent directory
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new DatabaseSync(dbPath);
  initSchema(_db);
  return _db;
}

/** Close the current db handle (used in tests to swap databases). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Schema ────────────────────────────────────────────────────────────────────

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT    PRIMARY KEY,
      title       TEXT    NOT NULL,
      description TEXT,
      assignee    TEXT,
      deadline    TEXT,
      status      TEXT    NOT NULL DEFAULT 'open',
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id:          String(row["id"]),
    title:       String(row["title"]),
    description: row["description"] != null ? String(row["description"]) : null,
    assignee:    row["assignee"]    != null ? String(row["assignee"])    : null,
    deadline:    row["deadline"]    != null ? String(row["deadline"])    : null,
    status:      String(row["status"]) as TaskStatus,
    createdAt:   String(row["created_at"]),
    updatedAt:   String(row["updated_at"]),
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignee?: string;
  deadline?: string;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const now = new Date().toISOString();
  const id  = randomUUID();

  db.prepare(`
    INSERT INTO tasks (id, title, description, assignee, deadline, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id,
    input.title,
    input.description ?? null,
    input.assignee    ?? null,
    input.deadline    ?? null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToTask(row);
}

export interface ListTasksInput {
  status?:   TaskStatus;
  assignee?: string;
}

export function listTasks(input: ListTasksInput = {}): Task[] {
  const db = getDb();

  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (input.status !== undefined) {
    conditions.push("status = ?");
    params.push(input.status);
  }
  if (input.assignee !== undefined) {
    conditions.push("assignee = ?");
    params.push(input.assignee);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql   = `SELECT * FROM tasks ${where} ORDER BY created_at DESC`;

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : null;
}

export function assignTask(taskId: string, assignee: string): Task | null {
  const db  = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    "UPDATE tasks SET assignee = ?, updated_at = ? WHERE id = ?",
  );
  const result = stmt.run(assignee, now, taskId) as { changes: number };

  if (result.changes === 0) return null;

  return getTask(taskId);
}

export function updateTaskStatus(taskId: string, status: TaskStatus): Task | null {
  const db  = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
  );
  const result = stmt.run(status, now, taskId) as { changes: number };

  if (result.changes === 0) return null;

  return getTask(taskId);
}
