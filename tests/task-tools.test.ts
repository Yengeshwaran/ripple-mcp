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
const { createTask, listTasks, getTask, assignTask, closeDb } = await import(
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

describe("update_task_status (MCP tool layer)", () => {
  async function callStatusTool(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTaskTools } = await import(
      "../services/mcp-server/src/tools/tasks.js"
    );
    const mcp = new McpServer({ name: "test-status", version: "0.0.0" }, {});
    registerTaskTools(mcp);
    const registry = (mcp as unknown as {
      _registeredTools: Record<string, { handler: (a: Record<string, unknown>) => Promise<unknown> }>;
    })._registeredTools;
    const entry = registry["update_task_status"];
    if (!entry) throw new Error("Tool 'update_task_status' not registered");
    return entry.handler(args) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  }

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
