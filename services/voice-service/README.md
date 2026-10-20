# services/voice-service

Turns a short, consented meeting recording into speaker-labelled transcript segments and
**candidate** tasks for human review.

```
audio upload -> AssemblyAI (transcript + timestamps + anonymous speaker labels)
             -> OpenRouter LLM (candidate tasks, strict JSON) -> server-side checks -> JSON response
```

This service **never saves tasks** and never calls MCP or SQLite. The frontend shows the result,
the user maps speakers and approves tasks, and approved tasks are saved through the existing
`McpTaskClient.createTask()`.

## Endpoint

`POST /api/voice/analyze-meeting` — `multipart/form-data`

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | WAV, MP3, M4A or WebM, up to `MAX_UPLOAD_MB` (default 25). Format is checked from the file's bytes. |
| `meeting_date` | no | `YYYY-MM-DD`. Needed to turn "by Friday" into `deadline_iso`. |
| `timezone` | no | IANA name, e.g. `America/Chicago`. Needed with `meeting_date`. |

Without both `meeting_date` and `timezone`, every `deadline_iso` is `null` (the spoken
`deadline_text` is still returned). These two fields are an addition to the playbook contract —
optional, so existing callers are unaffected.

`GET /health` → `{"status": "ok"}`

### Success (200)

Matches the playbook contract: `meeting_id`, `speakers`, `segments`, `candidate_tasks`.
See `tests/fixtures/meeting_demo_001.json` and `tests/fixtures/meeting_edge_cases.json`
(hand-written demo data, safe for the frontend to use as fixtures).

Rules the service enforces on every response, whatever the model returns:

- Speaker labels are anonymous (`SPEAKER_01`…, in order of first appearance). They are not identities.
- `needs_review` is always `true`.
- `owner_speaker_id` is `null` unless it is a real speaker label the model tied to explicit evidence.
- `deadline_iso` is `null` unless there is spoken `deadline_text`, the request gave `meeting_date` + `timezone`,
  and the value is ISO 8601 with a timezone offset.
- Every `evidence_segment_ids` entry exists in `segments`; candidates without valid evidence are dropped.
- `confidence` is not returned (LLM self-scores are not calibrated; the UI should use `needs_review` + evidence).
- `segments[].speaker_id` can be `null` if the provider gives no speaker for a turn.

### Errors

`{"error": {"code", "message", "retryable"}}` — no provider details, stack traces or keys.

| Status | Code | When |
| --- | --- | --- |
| 400 | `MISSING_FILE`, `EMPTY_FILE`, `INVALID_REQUEST` | no file, 0-byte file, bad `meeting_date`/`timezone` |
| 413 | `FILE_TOO_LARGE` | over `MAX_UPLOAD_MB` |
| 415 | `UNSUPPORTED_AUDIO_TYPE` | not WAV/MP3/M4A/WebM |
| 422 | `NO_SPEECH_DETECTED`, `UNUSABLE_AUDIO` | provider found no speech / could not transcribe |
| 422 | `INVALID_EXTRACTION_OUTPUT` | model output malformed twice (one retry) |
| 502 | `TRANSCRIPTION_PROVIDER_ERROR`, `EXTRACTION_PROVIDER_ERROR` | provider rejected the request (e.g. bad key) |
| 503 | `TRANSCRIPTION_PROVIDER_UNAVAILABLE`, `EXTRACTION_PROVIDER_UNAVAILABLE` | timeout, rate limit, provider down (`retryable: true`) |
| 503 | `SERVICE_NOT_CONFIGURED` | an API key or model is not set |

## Setup (Windows PowerShell)

Needs Python 3.11+.

```powershell
cd services/voice-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env      # then fill in the keys in .env
```

If PowerShell blocks `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### Environment variables (`.env`)

| Name | Required | Purpose |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | yes | AssemblyAI key |
| `OPENROUTER_API_KEY` | yes | OpenRouter key |
| `OPENROUTER_MODEL` | yes | an OpenRouter model id that supports structured outputs (`json_schema`) |
| `MAX_UPLOAD_MB` | no | default 25 |
| `ASSEMBLYAI_LANGUAGE_CODE` | no | force a language (e.g. `en`); empty = auto-detect |
| `ASSEMBLYAI_SPEAKERS_EXPECTED` | no | exact speaker count, only if certain |
| `TRANSCRIPTION_TIMEOUT_SECONDS` | no | default 180 |
| `EXTRACTION_TIMEOUT_SECONDS` | no | default 60 |

Keys stay in `.env` on the server. Never put them in `VITE_*` variables.

## Run

```powershell
uvicorn app.main:app --port 8002 --reload
```

Frontend: add a Vite proxy for `/api/voice` → `http://localhost:8002` (Member 2, `apps/web/vite.config.ts`).

## Test

```powershell
python -m pytest -q
```

All tests use mocked providers — no keys, no network, no cost. They cover the response contract,
timestamps, evidence IDs, null owner/deadline handling, empty/oversized/unsupported files,
provider timeouts and rate limits, malformed AI output (one retry, then a clean error),
missing configuration, and temp-file cleanup on success and failure.

### Optional live smoke test (real providers, small cost)

With the service running and keys in `.env`:

```powershell
python scripts/smoke_test.py path\to\consented-sample.m4a --meeting-date 2026-10-20 --timezone America/Chicago
```

Record what you observe in `docs/FEASIBILITY.md`.

## Privacy

- Uploads are written to a random temp file and deleted after transcription (success or failure).
- Logs contain IDs and counts only — no transcript text, audio, or keys.
- The extraction model receives transcript text with segment IDs and speaker labels, never audio.
- Recordings and private transcripts must not be committed (`.gitignore` already blocks common audio types).

## Known limitations

- Not yet tested against the live providers or on Tamil-English audio (see `docs/FEASIBILITY.md`).
- Speaker labels can be wrong on cross-talk or very short turns; the user must confirm the mapping.
- Duration is limited indirectly via file size only.
- Dependencies between tasks are not extracted (not in the agreed contract).
