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
import { createTask, listTasks, assignTask } from "../db.js";

// Reusable ISO 8601 deadline validator
const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), {
    message: "deadline must be a valid ISO 8601 date/time string",
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
        if (deadline    !== undefined) input.deadline    = deadline;
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
}
