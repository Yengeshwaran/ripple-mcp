# Ripple MCP

Ripple is a **planned** voice-aware collaborative task assistant for hackathon use.

It is intended to process a team meeting recording, identify speaker turns, map labels to consenting team members, extract tasks/deadlines/dependencies, and manage that task graph via MCP.

## Current status

The MCP server is live on branch `feature/task-tools`.

**Implemented MCP tools:**

| Tool | Description |
|---|---|
| `ping` | Connectivity check — echo an optional message back |
| `create_task` | Create a task (title required; description, assignee, deadline optional) |
| `list_tasks` | List tasks with optional `status` and `assignee` filters |
| `assign_task` | Assign (or re-assign) a task to a team member |

**Database:** SQLite via Node.js built-in `node:sqlite` (Node ≥ 22.5.0).
Development database: `data/ripple.db` (git-ignored).

## Monorepo structure

- `apps/web/` — React + Vite frontend placeholder
- `services/mcp-server/` — Node.js + TypeScript MCP server placeholder
- `services/voice-service/` — transcription/diarization placeholder
- `packages/shared/` — shared types/schemas placeholder
- `docs/` — architecture and team workflow docs
- `tests/` — testing strategy placeholder
- `data/` — local development data (non-committed artifacts)

## Planned architecture

See `docs/architecture.md`.

## Prerequisites

- Git
- Node.js (LTS)
- npm

## Setup

```powershell
git clone https://github.com/Yengeshwaran/ripple-mcp.git
cd ripple-mcp
```

When installable packages are added:

```powershell
npm install
```

## Development commands

```powershell
# Install dependencies
npm install

# Start MCP server (port 3100)
npm run mcp:dev

# TypeScript type check
npm run mcp:typecheck

# Run automated tests
npm test
```

MCP endpoint: `http://localhost:3100/mcp` (Streamable HTTP)
Health endpoint: `http://localhost:3100/health`

### Testing with MCP Inspector

1. `npx @modelcontextprotocol/inspector`
2. Connection type: **Streamable HTTP**
3. URL: `http://localhost:3100/mcp`
4. Connect → call `ping`, `create_task`, `list_tasks`, or `assign_task`

## Team guide

- Onboarding: `docs/TEAM_SETUP.md`
- Contribution rules: `docs/CONTRIBUTING.md`

## Team responsibilities

1. Team lead: MCP backend, data model, integration, and final release.
2. Member 2: React frontend and task dashboard.
3. Member 3: voice-processing research, speaker-label mapping workflow, task extraction, and integration testing.
