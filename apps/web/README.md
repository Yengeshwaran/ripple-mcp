# Ripple web app

React + TypeScript frontend. The dashboard uses a provisional `TaskClient` interface with a Streamable HTTP MCP adapter and an in-memory `MockTaskClient` fallback.

## Run locally

```powershell
npm install
npm run dev
```

The mock adapter supports creating tasks, listing tasks (with optional status/assignee filters), and assigning tasks. The MCP adapter uses the backend tool contract directly; the mock remains available for isolated UI development.

## Analyze a meeting recording

The meeting workflow posts the selected recording as `multipart/form-data` in the `file` field to:

```text
POST /api/voice/analyze-meeting
```

During local development, Vite proxies `/api/voice` to `http://localhost:8002`. Start the voice API on that port before uploading a real recording. The frontend accepts WAV, MP3, M4A, and WebM, checks the 25 MB and 3-minute limits when browser metadata is available (including the backend's 1-second duration-rounding tolerance), and displays structured server error codes and messages without substituting fake results. Optional meeting date (`YYYY-MM-DD`) and timezone (IANA name) fields are sent as `meeting_date` and `timezone`; provide both when you want the service to resolve explicit spoken deadlines. Server-side validation remains authoritative.

Use **Preview with sample** to inspect the transcript, speaker mapping, and candidate review UI without a running voice service. The sample is clearly marked synthetic and cannot be saved. For real analysis results, map speaker labels to teammates, edit candidates, explicitly approve them, and choose **Save approved**. Task writes use the existing MCP client; the voice API never writes tasks directly.

## Connect to the MCP server

Start the backend from the repository root in one terminal:

```powershell
npm run mcp:dev
```

Then start the web app from `apps/web/` in another terminal. Vite proxies the Streamable HTTP `/mcp` endpoint to `http://localhost:3100/mcp`; the React app uses the official `@modelcontextprotocol/sdk` client and does not call the task tools through REST.

To use the in-memory fallback during local UI development, set `VITE_USE_MOCK_TASK_CLIENT=true` in `apps/web/.env.local`. The default is the real MCP adapter. `VITE_MCP_URL` may override the endpoint URL when a same-origin proxy is not used.

## Local demo sign-in

The browser UI includes local sign-up/sign-in to preview profile and sign-out flows:

- Demo email: `demo@commitmentradar.app`
- Demo password: `RadarDemo2026!`

New local accounts and password hashes are stored in this browser; the active UI session is stored for the current browser tab. This is a frontend demo only: the MCP and voice-service APIs do not authenticate users or enforce account permissions. Do not use real credentials or treat this as production security. Production authentication requires a trusted identity provider or server-side auth service and backend authorization checks.

## Build

```powershell
npm run build
```
