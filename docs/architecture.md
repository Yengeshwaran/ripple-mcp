# Ripple Architecture (Initial)

This document describes the **planned** architecture for Ripple. It is scaffolding documentation only; implementation is not complete.

## Goal
Ripple helps a team process a recorded meeting and convert discussion into trackable tasks:
1. ingest recording
2. transcribe with speaker turns
3. map speaker labels to consenting team members
4. extract tasks, owners, deadlines, and dependencies
5. expose and manage task state through an MCP server

## Planned modules
- `apps/web/`: frontend UI for reviewing speakers, tasks, and dependencies.
- `services/mcp-server/`: Node.js + TypeScript MCP server (target MCP spec 2025-11-25+; Streamable HTTP).
- `services/voice-service/`: transcription, diarization, speaker-label mapping, and extraction orchestration.
- `packages/shared/`: shared contracts (types, schemas) across app and services.

## Planned high-level flow
1. User uploads/provides meeting recording (local/dev flow initially).
2. Voice service produces transcript + speaker labels (`SPEAKER_01`, etc.).
3. UI presents labels and asks user to map labels to consenting team members.
4. Extraction pipeline proposes tasks/deadlines/dependencies from transcript.
5. MCP server stores and serves task graph updates.
6. UI displays task board and dependency status.

## Design constraints
- Keep provider choices abstract: AI, transcription, diarization, and cloud providers are intentionally undecided.
- Keep architecture lightweight for a 3-person, 5-day hackathon delivery.
- Protect privacy: do not commit private recordings or secrets to source control.
