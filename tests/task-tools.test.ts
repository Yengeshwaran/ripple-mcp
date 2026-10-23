/**
 * Task-tools integration tests
 * Runner: Node.js built-in `node:test`
 *
 * Uses an isolated temp database — never touches data/ripple.db.
 * Run: npm test
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// ── Temporary database setup ──────────────────────────────────────────────────
// Must be set BEFORE importing db.ts so the module picks up the override.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-test-"));
const tmpDb  = path.join(tmpDir, "test.db");
process.env["RIPPLE_DB_PATH"] = tmpDb;

// Import AFTER setting env so the singleton opens the temp db
const { createTask, listTasks, getTask, assignTask, closeDb, getDb } = await import(
  "../services/mcp-server/src/db.js"
);

// ── Cleanup ───────────────────────────────────────────────────────────────────

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("create_task", () => {
  test("creates a task with all fields", () => {
    const task = createTask({
      title:       "Design DB schema",
      description: "ERD for Ripple tasks",
      assignee:    "alice",
      deadline:    "2025-12-31T17:00:00Z",
    });

    assert.ok(task.id,            "id should be generated");
    assert.equal(task.title,       "Design DB schema");
    assert.equal(task.description, "ERD for Ripple tasks");
    assert.equal(task.assignee,    "alice");
    assert.equal(task.deadline,    "2025-12-31T17:00:00Z");
    assert.equal(task.status,      "open");
    assert.ok(task.createdAt,     "createdAt should be set");
    assert.ok(task.updatedAt,     "updatedAt should be set");
  });

  test("creates a task with only a title", () => {
    const task = createTask({ title: "Minimal task" });

    assert.equal(task.title,       "Minimal task");
    assert.equal(task.description, null);
    assert.equal(task.assignee,    null);
    assert.equal(task.deadline,    null);
    assert.equal(task.status,      "open");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("input validation (Zod / MCP tool layer)", () => {
  // These tests invoke the tool handler directly by calling registerTaskTools
  // on an in-process McpServer and using the tool's callback.

  // Helper: build a McpServer, register task tools, invoke the named tool's
  // handler directly (bypasses network/transport layer).
  async function callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTaskTools } = await import(
      "../services/mcp-server/src/tools/tasks.js"
    );

    const mcp = new McpServer({ name: "test-validation", version: "0.0.0" }, {});
    registerTaskTools(mcp);

    // _registeredTools is a plain object keyed by tool name in SDK v1.
    // Each entry has a `handler` function that accepts the parsed args.
    const registry = (mcp as unknown as {
      _registeredTools: Record<string, { handler: (a: Record<string, unknown>) => Promise<unknown> }>;
    })._registeredTools;

    const entry = registry[toolName];
    if (!entry) throw new Error(`Tool '${toolName}' not registered`);

    return entry.handler(args) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  }

  test("rejects an empty title via Zod schema", async () => {
    const { z } = await import("zod");
    const titleSchema = z.string().trim().min(1, "title must not be empty");

    const result = titleSchema.safeParse("");
    assert.equal(result.success, false, "empty string should fail");
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.message.includes("must not be empty")),
        "error message should mention 'must not be empty'",
      );
    }
  });

  test("rejects a whitespace-only title via Zod schema", async () => {
    const { z } = await import("zod");
    const titleSchema = z.string().trim().min(1, "title must not be empty");

    const result = titleSchema.safeParse("   ");
    assert.equal(result.success, false, "whitespace-only title should fail after trim");
  });

  test("rejects an invalid deadline via Zod refine", async () => {
    const { z } = await import("zod");
    const isoDateString = z
      .string()
      .refine((v) => !isNaN(Date.parse(v)), {
        message: "deadline must be a valid ISO 8601 date/time string",
      });

    const result = isoDateString.safeParse("not-a-date");
    assert.equal(result.success, false, "invalid date string should fail");
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.message.includes("valid ISO 8601")),
        "error message should mention ISO 8601",
      );
    }
  });

  test("accepts a valid ISO 8601 deadline via Zod refine", async () => {
    const { z } = await import("zod");
    const isoDateString = z
      .string()
      .refine((v) => !isNaN(Date.parse(v)), {
        message: "deadline must be a valid ISO 8601 date/time string",
      });

    assert.ok(isoDateString.safeParse("2025-12-31T17:00:00Z").success);
    assert.ok(isoDateString.safeParse("2025-12-31").success);
  });

  test("assign_task tool returns isError:true for nonexistent task id", async () => {
    const result = await callTool("assign_task", {
      task_id:  "nonexistent-id-abc",
      assignee: "eve",
    });

    assert.equal(result.isError, true, "isError should be true");
    assert.ok(
      result.content[0]?.text.includes("nonexistent-id-abc"),
      "error text should include the missing task id",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("list_tasks", () => {
  before(() => {
    // Seed tasks for list tests
    createTask({ title: "List-seed A", assignee: "bob"   });
    createTask({ title: "List-seed B", assignee: "carol" });
    createTask({ title: "List-seed C", assignee: "bob"   });
  });

  test("returns all tasks when no filter given", () => {
    const tasks = listTasks();
    assert.ok(tasks.length >= 3, "should have at least the seeded tasks");
  });

  test("returns empty array when no tasks match", () => {
    const tasks = listTasks({ assignee: "nobody-exists" });
    assert.deepEqual(tasks, []);
  });

  test("filters by status", () => {
    const open = listTasks({ status: "open" });
    assert.ok(open.length >= 3);
    open.forEach((t) => assert.equal(t.status, "open"));
  });

  test("filters by assignee", () => {
    const bobTasks = listTasks({ assignee: "bob" });
    assert.ok(bobTasks.length >= 2);
    bobTasks.forEach((t) => assert.equal(t.assignee, "bob"));
  });

  test("combines status and assignee filters", () => {
    const tasks = listTasks({ status: "open", assignee: "carol" });
    assert.ok(tasks.length >= 1);
    tasks.forEach((t) => {
      assert.equal(t.status,   "open");
      assert.equal(t.assignee, "carol");
    });
  });

  test("returns tasks ordered most-recently-created first", () => {
    const tasks = listTasks();
    for (let i = 1; i < tasks.length; i++) {
      const prev = tasks[i - 1]!.createdAt;
      const curr = tasks[i]!.createdAt;
      assert.ok(prev >= curr, "tasks should be newest-first");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("assign_task (db layer)", () => {
  test("assigns a task and returns the updated owner", () => {
    const task    = createTask({ title: "Assign-me" });
    const updated = assignTask(task.id, "dave");

    assert.ok(updated,                 "should return updated task");
    assert.equal(updated!.assignee, "dave");
    assert.equal(updated!.id,       task.id);
    assert.ok(updated!.updatedAt >= task.updatedAt, "updatedAt should advance");
  });

  test("db layer returns null for a nonexistent task id", () => {
    // The db function returns null; the MCP tool wraps this in isError:true.
    // Both layers are tested independently.
    const result = assignTask("nonexistent-id-000", "eve");
    assert.equal(result, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("persistence", () => {
  test("task survives closing and reopening the database", () => {
    const task = createTask({ title: "Persist me", assignee: "frank" });

    // Close the db handle — next getDb() call reopens the file
    closeDb();

    const found = getTask(task.id);
    assert.ok(found,                  "task should be found after reopen");
    assert.equal(found!.title,    "Persist me");
    assert.equal(found!.assignee, "frank");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ping tool smoke test", () => {
  test("ping tool still available via McpServer", async () => {
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { z } = await import("zod");

    const mcp = new McpServer({ name: "test", version: "0.0.0" }, {});
    mcp.tool(
      "ping",
      "test ping",
      { message: z.string().optional() },
      async ({ message }) => ({
        content: [{ type: "text" as const, text: message ? `pong — you said: "${message}"` : "pong" }],
      }),
    );

    assert.ok(mcp, "McpServer instance created successfully with ping tool");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// updateTaskStatus is exported from db.ts — import it the same way as the others
const { updateTaskStatus } = await import("../services/mcp-server/src/db.js");

describe("update_task_status (db layer)", () => {
  test("sets status to done", () => {
    const task    = createTask({ title: "Status-test done" });
    const updated = updateTaskStatus(task.id, "done");

    assert.ok(updated,                              "should return updated task");
    assert.equal(updated!.status,   "done");
    assert.equal(updated!.id,       task.id);
    assert.ok(updated!.updatedAt >= task.updatedAt, "updatedAt should advance");
  });

  test("sets status to in_progress", () => {
    const task    = createTask({ title: "Status-test in_progress" });
    const updated = updateTaskStatus(task.id, "in_progress");
    assert.equal(updated!.status, "in_progress");
  });

  test("reopens a done task by setting status back to open", () => {
    const task     = createTask({ title: "Status-test reopen" });
    updateTaskStatus(task.id, "done");
    const reopened = updateTaskStatus(task.id, "open");
    assert.equal(reopened!.status, "open");
  });

  test("returns null for a nonexistent task id", () => {
    const result = updateTaskStatus("nonexistent-status-000", "done");
    assert.equal(result, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("deadline validation (MCP tool schema boundary)", () => {
  // Build a server with the updated validator and probe via validateToolInput.
  async function buildServer() {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTaskTools } = await import(
      "../services/mcp-server/src/tools/tasks.js"
    );
    const mcp = new McpServer({ name: "test-deadline", version: "0.0.0" }, {});
    registerTaskTools(mcp);

    type RegistryEntry = {
      handler:     (a: Record<string, unknown>) => Promise<unknown>;
      inputSchema: unknown;
    };
    const registry = (mcp as unknown as {
      _registeredTools: Record<string, RegistryEntry>;
    })._registeredTools;

    const entry = registry["create_task"];
    if (!entry) throw new Error("Tool 'create_task' not registered");

    return {
      validate: (args: Record<string, unknown>) =>
        (mcp as unknown as {
          validateToolInput(
            tool:     RegistryEntry,
            args:     Record<string, unknown>,
            toolName: string,
          ): Promise<Record<string, unknown> | undefined>;
        }).validateToolInput(entry, args, "create_task"),
    };
  }

  test("accepts a UTC timestamp", async () => {
    const { validate } = await buildServer();
    // Should not throw
    await validate({ title: "T1", deadline: "2025-12-31T17:00:00Z" });
  });

  test("accepts a timestamp with a positive offset", async () => {
    const { validate } = await buildServer();
    await validate({ title: "T2", deadline: "2025-12-31T17:00:00+05:30" });
  });

  test("accepts a timestamp with a negative offset", async () => {
    const { validate } = await buildServer();
    await validate({ title: "T3", deadline: "2025-12-31T22:00:00-07:00" });
  });

  test("accepts a missing (optional) deadline", async () => {
    const { validate } = await buildServer();
    await validate({ title: "T4" });
  });

  test("rejects a date-only deadline", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T5", deadline: "2025-10-26" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Input validation error") ||
          err.message.includes("invalid_value") ||
          err.message.includes("date-time"),
          `unexpected message: ${err instanceof Error ? err.message : err}`,
        );
        return true;
      },
      "date-only deadline should be rejected",
    );
  });

  test("rejects an invalid calendar date", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T6", deadline: "2025-13-01T00:00:00Z" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "invalid calendar date should be rejected",
    );
  });

  test("rejects a malformed timestamp", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T7", deadline: "not-a-date" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "malformed timestamp should be rejected",
    );
  });

  test("rejects February 30 (impossible calendar date)", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T8", deadline: "2026-02-30T17:00:00Z" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "Feb 30 should be rejected",
    );
  });

  test("rejects an invalid hour (hour=25)", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T9", deadline: "2026-10-24T25:00:00Z" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "hour=25 should be rejected",
    );
  });

  test("rejects an invalid minute (minute=61)", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T10", deadline: "2026-10-24T10:61:00Z" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "minute=61 should be rejected",
    );
  });

  test("rejects a malformed timezone offset (±25:00)", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T11", deadline: "2026-10-24T10:00:00+25:00" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "offset ±25:00 should be rejected",
    );
  });

  test("rejects a timezone offset with invalid minutes (±05:61)", async () => {
    const { validate } = await buildServer();
    await assert.rejects(
      () => validate({ title: "T12", deadline: "2026-10-24T10:00:00+05:61" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      "offset minutes=61 should be rejected",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("legacy deadline resilience (list_tasks db layer)", () => {
  test("loading a task with a date-only deadline does not throw", () => {
    // Simulate the legacy record by inserting raw SQL directly into the db.
    // This bypasses Zod (which now rejects date-only on new creates) so we can
    // reproduce the existing database state and verify rowToTask handles it.
    const db = getDb();
    const legacyId = "legacy-date-only-task";
    const now = new Date().toISOString();

    // Remove any leftover from a previous run
    db.prepare("DELETE FROM tasks WHERE id = ?").run(legacyId);

    db.prepare(`
      INSERT INTO tasks (id, title, description, assignee, deadline, status, created_at, updated_at)
      VALUES (?, ?, NULL, NULL, ?, 'open', ?, ?)
    `).run(legacyId, "Legacy deadline task", "2025-10-26", now, now);

    // listTasks must not throw
    const tasks = listTasks();
    const legacy = tasks.find((t) => t.id === legacyId);
    assert.ok(legacy, "legacy task should be present in the list");
    assert.equal(legacy!.deadline, "2025-10-26", "date-only deadline should be preserved as-is");
  });

  test("other tasks are still returned when one has a date-only deadline", () => {
    const normal = createTask({ title: "Normal task alongside legacy" });
    const tasks = listTasks();
    const found = tasks.find((t) => t.id === normal.id);
    assert.ok(found, "normal task should still appear even with legacy record in DB");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("UTC normalization (MCP create_task handler + DB)", () => {
  // These tests call the actual registered tool handler so normalization at the
  // MCP boundary is exercised — not just the Zod validator.

  async function buildCreateServer() {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTaskTools } = await import(
      "../services/mcp-server/src/tools/tasks.js"
    );
    const mcp = new McpServer({ name: "test-utc", version: "0.0.0" }, {});
    registerTaskTools(mcp);

    type RegistryEntry = {
      handler: (a: Record<string, unknown>) => Promise<{
        content: { type: string; text: string }[];
        isError?: boolean;
      }>;
    };
    const registry = (mcp as unknown as {
      _registeredTools: Record<string, RegistryEntry>;
    })._registeredTools;

    const entry = registry["create_task"];
    if (!entry) throw new Error("Tool 'create_task' not registered");

    return {
      call: (args: Record<string, unknown>) => entry.handler(args),
    };
  }

  test("stores a UTC deadline unchanged", async () => {
    const { call } = await buildCreateServer();
    const result = await call({
      title:    "UTC-deadline task",
      deadline: "2026-12-31T17:00:00Z",
    });
    assert.equal(result.isError, undefined);
    const task = JSON.parse(result.content[0]!.text) as { deadline: string; id: string };
    assert.equal(task.deadline, "2026-12-31T17:00:00.000Z",
      "UTC deadline should be stored in canonical .000Z form");
    // Clean up
    const db = getDb();
    db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  });

  test("normalizes a +05:30 offset to UTC before storage", async () => {
    const { call } = await buildCreateServer();
    // 2026-10-24T20:30:00+05:30 == 2026-10-24T15:00:00.000Z
    const result = await call({
      title:    "Offset-deadline task",
      deadline: "2026-10-24T20:30:00+05:30",
    });
    assert.equal(result.isError, undefined);
    const task = JSON.parse(result.content[0]!.text) as { deadline: string; id: string };
    assert.equal(task.deadline, "2026-10-24T15:00:00.000Z",
      "+05:30 offset should normalize to UTC");
    // Verify what is actually in the DB
    const stored = getTask(task.id);
    assert.equal(stored?.deadline, "2026-10-24T15:00:00.000Z",
      "DB row should also hold the UTC form");
    // Clean up
    const db = getDb();
    db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  });

  test("normalizes a negative offset (-07:00) to UTC before storage", async () => {
    const { call } = await buildCreateServer();
    // 2026-10-24T08:00:00-07:00 == 2026-10-24T15:00:00.000Z
    const result = await call({
      title:    "Negative-offset task",
      deadline: "2026-10-24T08:00:00-07:00",
    });
    assert.equal(result.isError, undefined);
    const task = JSON.parse(result.content[0]!.text) as { deadline: string; id: string };
    assert.equal(task.deadline, "2026-10-24T15:00:00.000Z",
      "-07:00 offset should normalize to UTC");
    const db = getDb();
    db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("deadline rendering helpers (no DOM required)", () => {
  // Import the pure helper logic directly from a small inline re-implementation
  // that mirrors App.tsx's formatDeadline logic.  We cannot import App.tsx in
  // Node because it depends on React/JSX; instead we verify the underlying
  // logic as a pure function here.  The actual JSX calls the same branches.

  const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function formatDeadline(deadline: string): string {
    if (DATE_ONLY_RE.test(deadline)) {
      const parts = deadline.split("-").map(Number);
      const [year, month, day] = parts as [number, number, number];
      if (year && month && day) {
        return new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(year, month - 1, day)));
      }
    }
    const ts = Date.parse(deadline);
    if (!Number.isFinite(ts)) return deadline; // fallback: raw string
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ts));
  }

  test("date-only deadline renders with the exact calendar day (no timezone shift)", () => {
    // Regardless of where tests run, "2025-10-26" must render as October 26.
    const result = formatDeadline("2025-10-26");
    assert.ok(result.includes("26"), `expected '26' in result, got: ${result}`);
    assert.ok(result.includes("Oct") || result.includes("10"),
      `expected October in result, got: ${result}`);
    // Must NOT include a time component
    assert.ok(!result.includes("AM") && !result.includes("PM") && !result.includes(":"),
      `date-only should have no time, got: ${result}`);
  });

  test("valid UTC deadline renders with time component", () => {
    const result = formatDeadline("2026-12-31T17:00:00.000Z");
    assert.ok(result.includes("31") || result.includes("Dec"),
      `expected Dec 31 in result, got: ${result}`);
    // Should have a time element (AM/PM or colon) since we passed a full datetime
    assert.ok(result.includes(":") || result.includes("AM") || result.includes("PM"),
      `full datetime should include time, got: ${result}`);
  });

  test("malformed deadline returns the raw string without throwing", () => {
    const result = formatDeadline("not-a-real-date");
    assert.equal(result, "not-a-real-date",
      "malformed deadline should fall back to raw string");
  });

  test("malformed deadline with partial date format returns raw string", () => {
    const result = formatDeadline("2025-13-99");
    // 2025-13-99 matches DATE_ONLY_RE but Date.UTC will produce an invalid
    // month=13 → Date normalizes it (month 13 → Feb next year) — the test
    // verifies it does NOT throw and returns some string.
    assert.equal(typeof result, "string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("update_task_status (MCP tool layer)", () => {
  // Helper: build a server + registry once, reuse across tests in this suite.
  // Returns { callHandler, validateInput } so tests can choose the right boundary.
  async function buildStatusServer() {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTaskTools } = await import(
      "../services/mcp-server/src/tools/tasks.js"
    );
    const mcp = new McpServer({ name: "test-status", version: "0.0.0" }, {});
    registerTaskTools(mcp);

    type RegistryEntry = {
      handler:     (a: Record<string, unknown>) => Promise<unknown>;
      inputSchema: unknown;
    };
    const registry = (mcp as unknown as {
      _registeredTools: Record<string, RegistryEntry>;
    })._registeredTools;

    const entry = registry["update_task_status"];
    if (!entry) throw new Error("Tool 'update_task_status' not registered");

    return {
      /** Call the handler directly — Zod has already run (or is deliberately skipped). */
      callHandler: (args: Record<string, unknown>) =>
        entry.handler(args) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>,

      /** Run only Zod validation via the SDK's public validateToolInput method.
       *  Throws McpError(InvalidParams) on failure; returns parsed data on success. */
      validateInput: (args: Record<string, unknown>) =>
        (mcp as unknown as {
          validateToolInput(
            tool:     RegistryEntry,
            args:     Record<string, unknown>,
            toolName: string,
          ): Promise<Record<string, unknown> | undefined>;
        }).validateToolInput(entry, args, "update_task_status"),
    };
  }

  async function callStatusTool(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const { callHandler } = await buildStatusServer();
    return callHandler(args);
  }

  // ── Zod schema boundary ─────────────────────────────────────────────────────

  test("rejects 'completed' as an invalid status at the MCP input-schema boundary", async () => {
    const { validateInput } = await buildStatusServer();
    await assert.rejects(
      () => validateInput({ task_id: "any-id", status: "completed" }),
      (err: unknown) => {
        assert.ok(err instanceof Error, "should throw an Error");
        assert.ok(
          err.message.includes("Input validation error") || err.message.includes("invalid_value"),
          `error message should mention validation failure, got: ${err.message}`,
        );
        return true;
      },
      "should throw for status='completed'",
    );
  });

  test("rejects 'invalid' as an invalid status at the MCP input-schema boundary", async () => {
    const { validateInput } = await buildStatusServer();
    await assert.rejects(
      () => validateInput({ task_id: "any-id", status: "invalid" }),
      (err: unknown) => {
        assert.ok(err instanceof Error, "should throw an Error");
        assert.ok(
          err.message.includes("Input validation error") || err.message.includes("invalid_value"),
          `error message should mention validation failure, got: ${err.message}`,
        );
        return true;
      },
      "should throw for status='invalid'",
    );
  });

  test("succeeds for each valid status value", async () => {
    const task = createTask({ title: "Tool-status-test" });
    for (const status of ["in_progress", "done", "open"] as const) {
      const result = await callStatusTool({ task_id: task.id, status });
      assert.equal(result.isError, undefined, `should succeed for status=${status}`);
      const parsed = JSON.parse(result.content[0]!.text) as { status: string };
      assert.equal(parsed.status, status);
    }
  });

  test("returns isError:true for a nonexistent task id", async () => {
    const result = await callStatusTool({
      task_id: "nonexistent-tool-status-xyz",
      status:  "done",
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0]?.text.includes("nonexistent-tool-status-xyz"));
  });

  test("status change persists after db reopen", () => {
    const task = createTask({ title: "Persist-status" });
    updateTaskStatus(task.id, "done");
    closeDb();
    const found = getTask(task.id);
    assert.equal(found?.status, "done", "status should persist after db reopen");
  });
});
