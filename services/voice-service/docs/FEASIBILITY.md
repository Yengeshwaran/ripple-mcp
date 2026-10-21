# Voice feasibility note (V1)

Observed results only. Anything not yet run is marked **Not yet verified**.

## Setup

| Item | Value |
| --- | --- |
| Transcription + diarization | AssemblyAI, default `speech_models`, `speaker_labels: true` |
| Language setting | `ASSEMBLYAI_LANGUAGE_CODE` empty → `language_detection: true` (automatic) |
| Extraction | OpenRouter, structured outputs (`json_schema`, strict) |
| Model used in live tests | `openai/gpt-oss-20b` (team choice `deepseek/deepseek-v4-flash-0731`: **Not yet verified**) |
| Agreed limits | 25 MB, 3 minutes, audio-only WAV / MP3 / M4A / WebM |

## Live runs

| Date | Recording | Result |
| --- | --- | --- |
| 20 Oct 2026 | Clip 1: MP4 (video), 1 speaker | First run: 502 `EXTRACTION_PROVIDER_ERROR`. Cause: request sent `temperature` with `require_parameters: true`; OpenRouter found no matching provider (404). Fixed by removing `temperature`. |
| 20 Oct 2026 | Clip 1 after fix | HTTP 200 in 14.5 s. Response matched the contract. 1 speaker, 1 segment, 0 candidate tasks. |
| 20 Oct 2026 | Clip 2: MP4 video | 413 `FILE_TOO_LARGE` (over 25 MB). Video recordings are too large for the limit. |
| _date_ | Clip 3: audio-only, 2+ speakers, explicit commitments (see script below) | _fill in after running_ |

Note: since the audio-only check was added, clips 1 and 2 (MP4 with video) would now be rejected with 415
`UNSUPPORTED_AUDIO_TYPE` before any provider call.

## Clip 3 checklist (fill in from the actual run)

Suggested consented script (2 speakers, ~1 minute):
- Speaker 1: "I'll prepare the demo slides by Thursday at 5 PM."
- Speaker 2: "I'll test the audio-upload flow tomorrow."
- Speaker 1: "Someone should look at the login bug."
- Speaker 2: "Maybe we could add dark mode later, not sure."

| Check | Observed |
| --- | --- |
| Speakers detected (actual vs detected) | |
| Speaker turns correct? Any mix-ups or cross-talk problems? | |
| Transcript readable? Names / technical terms correct? | |
| Timestamps in order (smoke test prints this) | |
| Candidate tasks returned | |
| Each commitment found? (slides / upload test) | |
| Owner proposed only where someone said "I'll…"? | |
| "Someone should…" → owner null? | |
| Dark-mode idea left out? | |
| `deadline_text` matches the words spoken? | |
| `deadline_iso` only for "Thursday at 5 PM" (with meeting date + timezone sent)? | |
| Evidence segment IDs point at the right lines? | |
| Request time | |
| Cost (AssemblyAI dashboard + OpenRouter activity page) | |

## Not yet verified

- Tamil-English code-switching. Do not claim support until a consented mixed-language sample has been tested.
- `deepseek/deepseek-v4-flash-0731` with structured outputs on OpenRouter.
- End-to-end through the frontend proxy and MCP save flow.

## Recommendation for the demo

- Record audio-only (phone voice memo / Windows Sound Recorder, M4A), under 3 minutes and 25 MB.
- Speakers take turns and say commitments explicitly ("I'll … by …").
