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

During local development, Vite proxies `/api/voice` to `http://localhost:8002`. Start the voice API on that port before uploading a real recording. The frontend accepts WAV, MP3, M4A, and WebM, checks the agreed 50 MB and 3-minute demo limits when browser metadata is available, and displays server errors without substituting fake results. Server-side validation remains authoritative.

Use **Preview with sample** to inspect the transcript, speaker mapping, and candidate review UI without a running voice service. The sample is clearly marked synthetic and cannot be saved. For real analysis results, map speaker labels to teammates, edit candidates, explicitly approve them, and choose **Save approved**. Task writes use the existing MCP client; the voice API never writes tasks directly.

## Connect to the MCP server

Start the backend from the repository root in one terminal:

```powershell
npm run mcp:dev
```

Then start the web app from `apps/web/` in another terminal. Vite proxies the Streamable HTTP `/mcp` endpoint to `http://localhost:3100/mcp`; the React app uses the official `@modelcontextprotocol/sdk` client and does not call the task tools through REST.

To use the in-memory fallback during local UI development, set `VITE_USE_MOCK_TASK_CLIENT=true` in `apps/web/.env.local`. The default is the real MCP adapter. `VITE_MCP_URL` may override the endpoint URL when a same-origin proxy is not used.

## Build

```powershell
npm run build
```
