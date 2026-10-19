# KIRO_CREW_LOG

Use this template to record actual Kiro Crew usage during the project.

## Session entry template

- Date:
- Teammate:
- Branch:
- Goal:
- Files changed:
- Prompts used (summary):
- Diffs reviewed by human:
- Tests/checks run:
- Results:
- Follow-up actions:


## Session 1 — Initial MCP Server

- Date: 19 October 2026
- Teammate: Team lead
- Branch: `feature/mcp-backend`
- Goal: Implement and validate the initial Ripple MCP server using Streamable HTTP.
- Files changed:
  - `package.json`
  - `package-lock.json`
  - `tsconfig.json`
  - `services/mcp-server/package.json`
  - `services/mcp-server/src/index.ts`
- Prompts used (summary): Asked Kiro Crew to inspect the repository, implement a minimal MCP server using the official TypeScript SDK, add a `ping` tool, configure development and type-check scripts, and fix the TypeScript configuration issue.
- Diffs reviewed by human: Reviewed the staged file list and change summary. Complete source-diff review should be confirmed before marking the full implementation as reviewed.
- Tests/checks run:
  - `npm run mcp:typecheck`
  - `npm run mcp:dev`
  - MCP Inspector connection using Streamable HTTP
  - Invoked `ping` with the message `hello Ripple`
- Results: TypeScript type checking passed. The server started on port 3100. MCP Inspector connected successfully using MCP specification version `2025-11-25`, and the `ping` tool returned `pong — you said: "hello Ripple"`.
- Follow-up actions: Review the complete source diff, then implement SQLite-backed task management tools: `create_task`, `list_tasks`, and `assign_task`. Record the subsequent Kiro Crew sessions separately.

## Session 2 — SQLite-Backed Task Tools

- Date: 19 October 2026
- Teammate: Team lead
- Branch: `feature/task-tools`
- Goal: Implement SQLite-backed MCP task management: `create_task`, `list_tasks`, and `assign_task` tools. Add automated tests. Update documentation.
- Files changed:
  - `services/mcp-server/src/db.ts` (new — SQLite layer: schema init, CRUD, open/close)
  - `services/mcp-server/src/tools/tasks.ts` (new — MCP tool registrations with Zod validation)
  - `services/mcp-server/src/tools/` (new directory)
  - `services/mcp-server/src/index.ts` (modified — import and register task tools)
  - `tests/task-tools.test.ts` (new — 17 automated tests across 6 suites)
  - `tests/package.json` (new — ESM declaration required for Node test runner)
  - `package.json` (modified — test script added)
  - `tsconfig.json` (modified — `tests/**/*.ts` added to `include`)
  - `README.md` (modified — tool table, database info, dev commands updated)
  - `KIRO_CREW_LOG.md` (modified — this entry)
- Prompts used (summary): Asked Kiro Crew to implement `create_task`, `list_tasks`, and `assign_task` using the Node built-in `node:sqlite` module, with input validation via Zod, parameterized SQL, configurable database path for test isolation, and a review pass to fix an inconsistency where `assign_task` returned `null` at the db layer but the MCP tool layer was not tested for `isError: true`. Both layers are now tested separately.
- Diffs reviewed by human: File list and change summary reviewed. Full source-diff review pending before merge.
- Tests/checks run:
  - `npm run mcp:typecheck` — exit 0, zero errors (verified after each iteration)
  - `npm test` — 17 tests, 6 suites, 0 failures (actual run output confirmed)
  - MCP Inspector — manually verified `create_task`, `list_tasks`, `assign_task`, and `ping` via Streamable HTTP at `http://localhost:3100/mcp`
- Results: TypeScript type checking clean. All 17 automated tests pass. Node built-in `node:sqlite` confirmed available on Node 24.19.0 — no extra dependencies required. Tests use an isolated temp database; `data/ripple.db` is never touched. Manual MCP Inspector verification confirmed: created a task, listed it, assigned it to another team member, and observed correct field values and status in all responses.
- Follow-up actions: Review the final Git diff, commit to `feature/task-tools`, push the branch, open a PR against `main`, complete code review before merging. Coordinate `status` enum values (`open`, `in_progress`, `done`) with Member 2 before the React dashboard consumes task data.

## Session 3 — Frontend MCP Integration

- Date: 19 October 2026
- Teammate: Member 2 (implementation assisted by Copilot; Kiro Crew was not used)
- Branch: `feature/frontend-mcp-integration`
- Goal: Connect the React dashboard to the SQLite-backed task tools using the official MCP TypeScript SDK and Streamable HTTP, while retaining the mock adapter as a fallback.
- Files changed:
  - `apps/web/package.json` and `apps/web/package-lock.json` (MCP SDK dependency)
  - `apps/web/src/services/taskClient.ts` (actual MCP tool-call activity type)
  - `apps/web/src/services/mcpTaskClient.ts` (new SDK client adapter for `create_task`, `list_tasks`, and `assign_task`)
  - `apps/web/src/App.tsx` and `apps/web/src/App.css` (task creation, assignment, loading/errors, live tool activity, connection status)
  - `apps/web/vite.config.ts` (development proxy for the Streamable HTTP `/mcp` endpoint)
  - `apps/web/README.md` (MCP and mock-fallback run instructions)
  - `KIRO_CREW_LOG.md` (this entry)
- Prompts used (summary): Implement the frontend-to-MCP integration on a new branch from latest `main`; use `Client` with `StreamableHTTPClientTransport`, match the existing task tools and field contract, enable create/reassignment with validation and visible errors, retain mock fallback, verify create/list/reassign and persistence after backend restart, run checks, and open a PR without merging.
- Diffs reviewed: Confirmed the adapter tool names and input keys against `services/mcp-server/src/tools/tasks.ts`, checked the task response contract against the SQLite layer, and verified the implementation diff is scoped to `apps/web/` plus this log. Team review is pending.
- Tests/checks run:
  - `npm run build` from `apps/web/` — passed.
  - `npm test` — 17 tests passed, 0 failed.
  - `npm run mcp:typecheck` — passed.
  - `git diff --check` — passed.
  - MCP health endpoint — HTTP 200.
  - Streamable HTTP initialize through Vite's `/mcp` proxy — HTTP 200, protocol `2025-11-25`.
  - Browser dashboard against the running backend — `list_tasks`, `create_task`, and `assign_task` all succeeded; created a task, listed it, reassigned it, and confirmed the resulting tool inputs/outputs in the activity panel.
  - Restarted the backend with the same isolated temporary SQLite database and reloaded the dashboard — created task and new assignee remained present.
  - Dashboard title validation — blank/whitespace title displayed `Task title is required.` without sending a create call.
- Results: Frontend connects to the real MCP server over the SDK Streamable HTTP transport. Task create, list, assign, and persistence-after-restart were verified against SQLite. The in-memory `MockTaskClient` remains available when `VITE_USE_MOCK_TASK_CLIENT=true`; the MCP activity panel clearly indicates that mode and does not label mock calls as live. No backend files or `.kiro/` directory were added.
- Follow-up actions: Review PR before merge. Browser logs show the SDK's optional `GET /mcp` SSE request receives HTTP 404 because the server currently exposes only `POST /mcp`; POST-based tool operations and persistence succeed. Backend owner should confirm/fix the unsupported-GET response (Streamable HTTP servers that do not offer GET streams should respond with 405) if needed.
