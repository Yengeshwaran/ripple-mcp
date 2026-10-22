# Ripple Architecture

## Goal

Ripple helps a team process a recorded meeting and convert discussion into trackable,
human-approved commitments:

1. Ingest a consented audio recording.
2. Transcribe with speaker timestamps and anonymous diarization labels.
3. Extract candidate tasks, owners, and deadlines using an LLM.
4. Present candidates for human review: map speakers, edit titles/owners, approve or reject.
5. Write only approved tasks to SQLite via MCP.
6. Support assignment and status updates on saved tasks.

## Implemented modules

| Module | Path | Description |
|---|---|---|
| React dashboard | `apps/web/src/App.tsx` | Task list, filters, completion toggle, MCP log |
| Meeting review panel | `apps/web/src/MeetingReviewPanel.tsx` | Upload, transcript, speaker mapping, approval |
| MCP server | `services/mcp-server/src/index.ts` | Express + MCP Streamable HTTP, port 3100 |
| SQLite layer | `services/mcp-server/src/db.ts` | `node:sqlite` CRUD, `RIPPLE_DB_PATH` override |
| MCP tools | `services/mcp-server/src/tools/tasks.ts` | `create_task`, `list_tasks`, `assign_task`, `update_task_status` |
| Voice service | `services/voice-service/app/` | FastAPI, AssemblyAI, OpenRouter, port 8002 |

## Data flow

```
Audio upload
    │
    ▼
POST /api/voice/analyze-meeting (FastAPI, port 8002)
    │
    ├── AssemblyAI ──► transcript + timestamps + anonymous speaker labels
    │
    └── OpenRouter LLM ──► candidate tasks (needs_review: true, no task is saved here)
            │
            ▼
    Browser (React, port 5174)
            │
            ├── Human maps speakers, reviews evidence, edits, approves/rejects
            │
            └── Approved tasks only ──► POST /mcp (Node.js MCP server, port 3100)
                                                │
                                                ▼
                                           SQLite (data/ripple.db)
```

The voice service never persists tasks or calls MCP. Nothing is saved without human approval.

## Design constraints

- Privacy: no private recordings or secrets committed to source control.
- Lightweight: 3-person, 5-day hackathon delivery.
- Provider independence: AI, transcription, and cloud providers are abstracted behind
  service interfaces; the frontend talks to the MCP server via the `TaskClient` interface.
- No production deployment: this is a local demo.

## MCP transport

Stateless Streamable HTTP (MCP spec 2025-11-25+). One `McpServer` and
`StreamableHTTPServerTransport` instance per POST request. No in-memory session state.

## Known limitations

See `README.md` and `docs/JUDGE_QUICKSTART.md`.
