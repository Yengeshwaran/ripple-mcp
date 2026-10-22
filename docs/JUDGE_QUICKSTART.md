# Judge Quickstart — Ripple Local Demo

This runbook takes you from a fresh clone to a running demo. No existing tools, accounts, or
team context are assumed. Follow each terminal in order; all commands are Windows PowerShell.

---

## Prerequisites

Install these before starting:

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | ≥ 22.5.0 (Node 24 tested) | `node --version` |
| Python | 3.11+ | `python --version` |
| AssemblyAI API key | for live meeting analysis | [assemblyai.com](https://www.assemblyai.com/) |
| OpenRouter API key + model | for live task extraction | [openrouter.ai](https://openrouter.ai/) |

**No API keys?** Run the frontend and MCP server without them by using mock mode
(`VITE_USE_MOCK_TASK_CLIENT=true`). The voice service requires real keys for live analysis.
A known-working model is `openai/gpt-oss-20b` (live-tested 20 Oct 2026). See
[`services/voice-service/docs/FEASIBILITY.md`](../services/voice-service/docs/FEASIBILITY.md).

---

## Clone

```powershell
git clone https://github.com/Yengeshwaran/ripple-mcp.git
cd ripple-mcp
```

---

## Terminal 1 — MCP backend

Run from the **repository root**.

```powershell
npm ci
```

Verify the backend before starting:

```powershell
npm run mcp:typecheck   # TypeScript type check — must exit 0
npm test                # 26 tests, 8 suites, 0 failures
```

Start the server:

```powershell
npm run mcp:dev
```

Expected output:

```
Ripple MCP server listening on http://localhost:3100
  MCP endpoint : POST http://localhost:3100/mcp
  Health check : GET  http://localhost:3100/health
```

### SQLite database path

The default database is `data/ripple.db` inside the repository root. It is created
automatically on first use and is git-ignored.

To use a known, repeatable path (useful when you restart the server and want to see the
same records):

```powershell
$env:RIPPLE_DB_PATH = "C:\path\to\my-demo.db"
npm run mcp:dev
```

If you restart the server, set the same `RIPPLE_DB_PATH` to the same path; otherwise a
new database is created at the default location and previously saved tasks will not appear.

### Verify the MCP server

```powershell
Invoke-WebRequest -Uri http://localhost:3100/health | Select-Object -ExpandProperty Content
# Expected: {"status":"ok","server":"ripple-mcp","version":"0.1.0"}
```

---

## Terminal 2 — Voice service

Run from `services/voice-service` inside the repository.

```powershell
cd services/voice-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks `Activate.ps1`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
pip install -r requirements-dev.txt
```

Create the `.env` file:

```powershell
Copy-Item .env.example .env
```

Open `.env` in a text editor and fill in the three required values:

```dotenv
ASSEMBLYAI_API_KEY=<your AssemblyAI key>
OPENROUTER_API_KEY=<your OpenRouter key>
OPENROUTER_MODEL=openai/gpt-oss-20b
```

`openai/gpt-oss-20b` is the model live-tested by the team on 20 Oct 2026. It is not a
guaranteed service — provider availability can change. `deepseek/deepseek-v4-flash-0731`
is the team's preferred model but has not yet been live-tested.

> ⚠️ **Never commit `.env` to Git.** The `.gitignore` already excludes it, but confirm
> before staging any files. Never put API keys in `VITE_*` environment variables —
> they are embedded in the compiled JavaScript and visible to anyone who loads the page.

Run the voice service regression tests (no keys required):

```powershell
python -m pytest -q
# Expected: 94 passed, 0 failed
```

Start the service:

```powershell
uvicorn app.main:app --port 8002 --reload
```

Expected output:

```
INFO:     Uvicorn running on http://0.0.0.0:8002 (Press CTRL+C to quit)
```

Verify:

```powershell
Invoke-WebRequest -Uri http://localhost:8002/health | Select-Object -ExpandProperty Content
# Expected: {"status":"ok"}
```

---

## Terminal 3 — Frontend

Run from `apps/web` inside the repository.

```powershell
cd apps/web
npm ci
npm run build           # type check + production build — must exit 0
npm run dev -- --port 5174 --strictPort
```

Expected output:

```
  VITE v8.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5174/
```

Open **http://localhost:5174** in your browser.

### Proxy routes

The Vite dev server (`vite.config.ts`) proxies:

| Browser path | Forwarded to |
|---|---|
| `/mcp` | `http://localhost:3100` (MCP server) |
| `/api/voice` | `http://localhost:8002` (voice service) |

Both services must be running for full functionality.

### Mock mode

The frontend defaults to the real MCP adapter. To test the UI without a running MCP
server, set `VITE_USE_MOCK_TASK_CLIENT=true` in `apps/web/.env.local`. This uses
an in-memory mock and does **not** call the MCP server or persist any tasks. Do not
use mock mode to demonstrate real backend integration.

---

## Endpoints at a glance

| Service | Endpoint | Method | Purpose |
|---|---|---|---|
| MCP server | `http://localhost:3100/health` | GET | Health check |
| MCP server | `http://localhost:3100/mcp` | POST | MCP Streamable HTTP |
| Voice service | `http://localhost:8002/health` | GET | Health check |
| Voice service | `http://localhost:8002/api/voice/analyze-meeting` | POST | Meeting analysis |
| Frontend | `http://localhost:5174` | — | Dashboard |

---

## Demo checklist

Work through these steps in order to demonstrate end-to-end functionality.

### Setup

- [ ] All three terminals are running and showing no errors.
- [ ] `http://localhost:3100/health` returns `{"status":"ok","server":"ripple-mcp","version":"0.1.0"}`.
- [ ] `http://localhost:8002/health` returns `{"status":"ok"}`.
- [ ] `http://localhost:5174` loads the dashboard.

### Sign in

- [ ] Open `http://localhost:5174` and sign in using the local demo sign-in form.
  The dashboard uses local session storage — no external authentication service.
  Create a demo account with any email and password if one does not already exist.

### Meeting analysis

- [ ] Prepare a short, consented, audio-only recording (WAV, MP3, M4A, or WebM).
  Requirements: under 25 MB, under 3 minutes, two clearly distinguishable speakers,
  at least one explicit commitment ("I'll do X by [date/day]").
  Do not use a real meeting recording that contains private or sensitive information.
- [ ] In the dashboard, navigate to the Meeting Analysis panel.
- [ ] Upload the recording. Enter the meeting date (`YYYY-MM-DD`) and an IANA timezone
  (e.g. `America/Chicago`). Both are needed for deadline extraction.
- [ ] Click Analyze. Wait for the result (typically 10–30 seconds for a short clip).
- [ ] Inspect the returned transcript segments. Verify that timestamps are in order
  and that speaker labels are anonymous (`SPEAKER_01`, `SPEAKER_02`, …).

### Speaker mapping

- [ ] Map each anonymous speaker label to a teammate name.
  Speaker labels are AI-generated and must be verified by a human — they can be
  wrong on cross-talk or very short turns.

### Task review

- [ ] Review the candidate task list. Each task shows its proposed title, owner
  (derived from speaker mapping), deadline, and the transcript evidence segment.
- [ ] Edit any task title or owner that is incorrect.
- [ ] **Reject or leave unapproved at least one suggestion** to demonstrate that the
  approval step is meaningful — unapproved tasks are never saved.
- [ ] **Approve only the tasks you intend to save.**

### Save approved tasks

- [ ] Click Save Approved Tasks.
- [ ] Verify in the Commitments panel that **only the approved tasks appear**.
  The MCP activity log (right panel) should show `create_task` calls with `Success`
  for each approved task and no calls for rejected ones.

### Task management

- [ ] Reassign one task using the Reassign control. The MCP log should show an
  `assign_task` call.
- [ ] Toggle the completion circle on a task. One click marks it `done`; a second
  click reopens it (`open`). The MCP log should show an `update_task_status` call.
- [ ] Verify the filter tabs (Open / In progress / Completed) and counts update correctly.

### SQLite verification

Open a second PowerShell window to inspect the database directly:

```powershell
# From the repo root (or use the RIPPLE_DB_PATH you set earlier)
node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.RIPPLE_DB_PATH ?? 'data/ripple.db');
const rows = db.prepare('SELECT id, title, status, assignee FROM tasks').all();
console.table(rows);
db.close();
"
```

Verify that the table contains exactly the tasks you approved and their current statuses.

---

## Test commands (summary)

```powershell
# From repo root
npm run mcp:typecheck           # TypeScript — exit 0
npm test                        # 26 backend tests, 0 failures

# From apps/web
npm run build                   # frontend type check + Vite build — exit 0

# From services/voice-service (venv active)
python -m pytest -q             # 94 tests, 0 failures (all mocked — no keys needed)
```

All automated tests use in-process or mocked dependencies. No live API calls are made.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SERVICE_NOT_CONFIGURED` (503) | Missing API key in `.env` | Add `ASSEMBLYAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| `EXTRACTION_PROVIDER_ERROR` (502) | Invalid key or model unavailable | Verify key on openrouter.ai; try `openai/gpt-oss-20b` |
| `TRANSCRIPTION_PROVIDER_UNAVAILABLE` (503) | AssemblyAI timeout / rate limit | Wait and retry (`retryable: true` in error body) |
| Port 3100 already in use | Another process | `netstat -ano \| findstr :3100`; kill the PID |
| Port 8002 already in use | Another process | Use a different `--port` in the uvicorn command |
| Port 5174 already in use | Another process | Use a different `--port` in the Vite command |
| `UNSUPPORTED_AUDIO_TYPE` (415) | File contains a video track | Re-export as audio-only M4A or WAV |
| `FILE_TOO_LARGE` (413) | File > 25 MB | Trim or re-encode at a lower bitrate |
| `AUDIO_TOO_LONG` (413) | Recording > 3 minutes | Trim to under 3 minutes |
| No deadlines extracted | Missing `meeting_date` or `timezone` | Supply both fields in the analysis form |
| No tasks appear after analysis | No explicit commitments in audio | Check audio content; speakers should say "I'll do X by …" |
| Tasks not in Commitments panel | Wrong `RIPPLE_DB_PATH` or server restarted with different path | Restart MCP server with the same `RIPPLE_DB_PATH` |
| Frontend shows "Connecting" | MCP server not running | Start `npm run mcp:dev` |
| Frontend shows mock mode | `VITE_USE_MOCK_TASK_CLIENT=true` | Remove that variable from `apps/web/.env.local` |
| `INVALID_EXTRACTION_OUTPUT` (422) | Model returned malformed JSON twice | Retry; consider switching to a different model |

---

## Known limitations

- No production deployment — local demo only.
- Speaker diarization accuracy varies. Cross-talk and very short turns can produce wrong labels.
- MP3 and browser-recorded WebM files are length-checked only after transcription (a small cost before rejection for over-long files of those formats).
- The `deepseek/deepseek-v4-flash-0731` model has not been live-tested. Use `openai/gpt-oss-20b` for the demo.
- Tamil-English code-switching is not yet tested.
- Task dependencies are not extracted.
