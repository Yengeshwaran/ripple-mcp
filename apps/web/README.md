# Ripple web app

Day 1 React + TypeScript frontend scaffold. The dashboard reads provisional tasks through a `TaskClient` interface backed by `MockTaskClient`; no backend transport is configured.

## Run locally

```powershell
npm install
npm run dev
```

The mock adapter supports creating tasks, listing tasks (with optional status/assignee filters), and assigning tasks. Replace it with a real adapter only after the team agrees on the MCP communication approach and task contract.

## Build

```powershell
npm run build
```
