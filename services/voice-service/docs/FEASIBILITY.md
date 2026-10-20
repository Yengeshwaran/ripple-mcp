# Voice feasibility note (V1)

Fill this in after the first real sample. Do not claim results you have not observed.

| Item | Result |
| --- | --- |
| Date tested | |
| Tested by | |
| Transcription + diarization provider | AssemblyAI (model used: default `speech_models`) |
| Extraction provider / model | OpenRouter / `<OPENROUTER_MODEL>` |
| Sample length and format | e.g. 2 min 10 s, M4A |
| Languages spoken in sample | e.g. English only / Tamil-English mix |
| Number of speakers (actual vs detected) | |
| Transcript quality (names, technical terms) | |
| Speaker turns correct? | |
| Tamil-English code-switching result | |
| Candidate tasks: correct / missed / invented | |
| End-to-end time for the request | |
| Decided file types | WAV, MP3, M4A, WebM (service accepts these) |
| Decided size limit | 25 MB (`MAX_UPLOAD_MB`) |

## Problems seen

- (fill in)

## Recommendation for the demo

- (fill in)

## Not yet verified

- Whether AssemblyAI handles the team's Tamil-English mix well enough. The service can force a language with
  `ASSEMBLYAI_LANGUAGE_CODE`; AssemblyAI also documents code-switching options that this service does not set yet.
- Cost per request for the chosen OpenRouter model.
