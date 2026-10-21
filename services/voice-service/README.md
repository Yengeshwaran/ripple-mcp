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
| `file` | yes | Audio-only WAV, MP3, M4A or WebM, up to 25 MB and 3 minutes (see **Upload limits**). |
| `meeting_date` | no | `YYYY-MM-DD`. Needed to turn "by Friday" into `deadline_iso`. |
| `timezone` | no | IANA name, e.g. `America/Chicago`. Needed with `meeting_date`. |

Without both `meeting_date` and `timezone`, every `deadline_iso` is `null` (the spoken
`deadline_text` is still returned). These two fields are an addition to the playbook contract —
optional, so existing callers are unaffected.

`GET /health` → `{"status": "ok"}`

### Upload limits (agreed demo limits, same as the frontend)

| Limit | Default | Setting | How the server enforces it |
| --- | --- | --- | --- |
| Size | 25 MB | `MAX_UPLOAD_MB` | Upload is streamed and rejected as soon as it passes the limit (413 `FILE_TOO_LARGE`). |
| Length | 3 minutes | `MAX_AUDIO_SECONDS=180` (0 = off) | WAV, M4A/MP4 and WebM files that state their length are checked **before** anything is sent to AssemblyAI. MP3 files, and WebM files without a length field (typical browser recordings), are checked **after transcription** using the length AssemblyAI measured, and **before** task extraction. Either way an over-long file returns 413 `AUDIO_TOO_LONG` and no suggestions. A 1-second tolerance allows for rounding. |
| Format | WAV, MP3, M4A, WebM | — | Detected from the file's bytes, not its name or content type. |
| Audio only | — | — | M4A/MP4/MOV and WebM files are opened and rejected if they contain a video track or no audio track (415 `UNSUPPORTED_AUDIO_TYPE`, message says the file contains video). Uses the Python standard library only — no FFmpeg. Cover art in M4A files is metadata, not a video track, and is accepted. |

Note: for MP3 and browser-recorded WebM, an over-long file is uploaded to and transcribed by AssemblyAI before it is
rejected (a small transcription cost), because the length cannot be read from those files without extra
dependencies such as FFmpeg.

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
| 413 | `AUDIO_TOO_LONG` | longer than `MAX_AUDIO_SECONDS` |
| 415 | `UNSUPPORTED_AUDIO_TYPE` | not WAV/MP3/M4A/WebM, contains video, or has no audio track |
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
| `OPENROUTER_MODEL` | yes | an OpenRouter model id that supports structured outputs (`json_schema`). A 404 `EXTRACTION_PROVIDER_ERROR` usually means the model has no provider supporting that. |
| `MAX_UPLOAD_MB` | no | default 25 |
| `MAX_AUDIO_SECONDS` | no | default 180 (3 minutes); 0 disables |
| `ASSEMBLYAI_LANGUAGE_CODE` | no | set (e.g. `en`) → sent as `language_code`; empty → `language_detection: true` (AssemblyAI does not accept both) |
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
Regression tests also cover language detection (both `ASSEMBLYAI_LANGUAGE_CODE` paths), audio-only
validation on generated MP4/WebM containers (video, no-audio, unreadable, renamed files), and the 3-minute limit
before and after transcription.

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

- Live-provider results so far are in `docs/FEASIBILITY.md`; Tamil-English audio is untested.
- Speaker labels can be wrong on cross-talk or very short turns; the user must confirm the mapping.
- MP3 and browser-recorded WebM are length-checked only after transcription (see **Upload limits**).
- Dependencies between tasks are not extracted (not in the agreed contract).
