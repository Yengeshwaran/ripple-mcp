# Ripple web app

React + TypeScript frontend. The dashboard uses a provisional `TaskClient` interface with a Streamable HTTP MCP adapter and an in-memory `MockTaskClient` fallback.

## Run locally

```powershell
npm install
npm run dev
```

The mock adapter supports creating tasks, listing tasks (with optional status/assignee filters), and assigning tasks. The MCP adapter uses the backend tool contract directly; the mock remains available for isolated UI development.

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
