/**
 * tasks.ts — MCP tool registrations for task management
 *
 * Registers three tools on the provided McpServer instance:
 *   - create_task
 *   - list_tasks
 *   - assign_task
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createTask, listTasks, assignTask, updateTaskStatus } from "../db.js";

// ── Strict ISO 8601 date-time validator ───────────────────────────────────────
//
// Requires:  YYYY-MM-DDTHH:MM:SS[.sss](Z | ±HH:MM)
// Rejects:   date-only ("2025-10-26"), no timezone, bad months/days/times,
//            impossible calendar dates ("2026-02-30"), bad offsets (±25:00).
//
// After validation the value is NORMALIZED to UTC ISO format before storage so
// every stored deadline is canonical regardless of the input timezone.

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Returns true only when year/month/day/hour/min/sec are all in range AND the
 *  calendar date is real (e.g. rejects Feb 30 and Apr 31). */
function isStrictIsoDatetime(v: string): boolean {
  const m = ISO_DATETIME_RE.exec(v);
  if (!m) return false;

  const year  = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day   = parseInt(m[3]!, 10);
  const hour  = parseInt(m[4]!, 10);
  const min   = parseInt(m[5]!, 10);
  const sec   = parseInt(m[6]!, 10);

  // Basic field ranges
  if (month < 1 || month > 12) return false;
  if (day   < 1 || day   > 31) return false;
  if (hour  > 23)              return false;
  if (min   > 59)              return false;
  if (sec   > 59)              return false;

  // Timezone offset range: ±23:59 (UTC offsets in practice are ≤ ±14:00 but
  // we allow ±23:59 to be liberal while still blocking ±25:00 etc.)
  if (m[7] !== "Z") {
    const offH = parseInt(m[9]!,  10);
    const offM = parseInt(m[10]!, 10);
    if (offH > 23 || offM > 59) return false;
  }

  // Verify the calendar date is real: Date.UTC normalises impossible dates
  // (e.g. Feb 30 becomes Mar 1 or 2), so we compare day back.
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year  ||
    check.getUTCMonth()    !== month - 1 ||
    check.getUTCDate()     !== day
  ) {
    return false; // impossible calendar date
  }

  return true;
}

/** Normalize an already-validated ISO datetime string to UTC ("…Z") format. */
export function normalizeToUtc(v: string): string {
  return new Date(v).toISOString();
}

const isoDateString = z
  .string()
  .refine(isStrictIsoDatetime, {
    message:
      "deadline must be a valid ISO 8601 date-time with an explicit timezone " +
      'and a real calendar date, e.g. "2025-12-31T17:00:00Z" or ' +
      '"2025-12-31T17:00:00+05:30". Date-only values are not accepted.',
  });

// ── create_task ───────────────────────────────────────────────────────────────

export function registerTaskTools(mcp: McpServer): void {
  mcp.tool(
    "create_task",
    `Create a new task and save it to the database.
Returns the saved task with its generated id, status='open', and timestamps.
Use this when a user mentions a new action item, deliverable, or to-do.`,
    {
      title: z
        .string()
        .trim()
        .min(1, "title must not be empty")
        .describe("Short, human-readable task title (required)"),
      description: z
        .string()
        .optional()
        .describe("Longer description of the task (optional)"),
      assignee: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Team-member identifier to assign the task to (optional)"),
      deadline: isoDateString
        .optional()
        .describe("ISO 8601 deadline, e.g. 2025-12-31T17:00:00Z (optional)"),
    },
    async ({ title, description, assignee, deadline }) => {
      try {
        const input: import("../db.js").CreateTaskInput = { title };
        if (description !== undefined) input.description = description;
        if (assignee    !== undefined) input.assignee    = assignee;
        // Normalize deadline to canonical UTC before persistence so all stored
        // deadlines are uniform regardless of the input timezone offset.
        if (deadline    !== undefined) input.deadline    = normalizeToUtc(deadline);
        const task = createTask(input);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(task, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating task: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_tasks ──────────────────────────────────────────────────────────────

  mcp.tool(
    "list_tasks",
    `Return tasks from the database, optionally filtered by status and/or assignee.
Returns an empty array when no tasks match.
Results are ordered most-recently-created first.`,
    {
      status: z
        .enum(["open", "in_progress", "done"])
        .optional()
        .describe("Filter by task status (optional)"),
      assignee: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Filter by assignee identifier (optional)"),
    },
    async ({ status, assignee }) => {
      try {
        const filter: import("../db.js").ListTasksInput = {};
        if (status   !== undefined) filter.status   = status;
        if (assignee !== undefined) filter.assignee = assignee;
        const tasks = listTasks(filter);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(tasks, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing tasks: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── assign_task ─────────────────────────────────────────────────────────────

  mcp.tool(
    "assign_task",
    `Assign (or re-assign) an existing task to a team member.
Returns the updated task on success.
Returns a tool-level error if the task does not exist or inputs are invalid.`,
    {
      task_id: z
        .string()
        .trim()
        .min(1, "task_id must not be empty")
        .describe("The id of the task to update (required)"),
      assignee: z
        .string()
        .trim()
        .min(1, "assignee must not be empty")
        .describe("Team-member identifier to assign to (required)"),
    },
    async ({ task_id, assignee }) => {
      try {
        const updated = assignTask(task_id, assignee);
        if (!updated) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Task not found: no task with id "${task_id}" exists.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error assigning task: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_task_status ──────────────────────────────────────────────────────

  mcp.tool(
    "update_task_status",
    `Update the status of an existing task to open, in_progress, or done.
Returns the updated task on success.
Returns a tool-level error if the task does not exist or the status value is invalid.`,
    {
      task_id: z
        .string()
        .trim()
        .min(1, "task_id must not be empty")
        .describe("The id of the task to update (required)"),
      status: z
        .enum(["open", "in_progress", "done"])
        .describe("New status value: open | in_progress | done (required)"),
    },
    async ({ task_id, status }) => {
      try {
        const updated = updateTaskStatus(task_id, status);
        if (!updated) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Task not found: no task with id "${task_id}" exists.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating task status: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
