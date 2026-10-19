# Ripple MCP

Ripple is a **planned** voice-aware collaborative task assistant for hackathon use.

It is intended to process a team meeting recording, identify speaker turns, map labels to consenting team members, extract tasks/deadlines/dependencies, and manage that task graph via MCP.

## Current status

This repository currently contains **initial scaffolding and documentation only**.
Core application logic is not implemented yet.

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

## Development commands (scaffolding phase)

At this stage, runnable app commands are not available yet. This will be updated once app/service packages are added.

## Team guide

- Onboarding: `docs/TEAM_SETUP.md`
- Contribution rules: `docs/CONTRIBUTING.md`

## Team responsibilities

1. Team lead: MCP backend, data model, integration, and final release.
2. Member 2: React frontend and task dashboard.
3. Member 3: voice-processing research, speaker-label mapping workflow, task extraction, and integration testing.
