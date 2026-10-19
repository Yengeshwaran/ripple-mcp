/**
 * Ripple MCP Server
 * Transport : Streamable HTTP  (MCP spec 2025-11-25+)
 * SDK       : @modelcontextprotocol/sdk v1.x
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

const PORT = Number(process.env["PORT"] ?? 3100);

// ── MCP Server factory ───────────────────────────────────────────────────────
// We create a fresh McpServer per request (stateless mode).
// Stateless is the right default here — no need to track sessions in memory.

function buildMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "ripple-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // ping tool: optional message → readable reply
  mcp.tool(
    "ping",
    "Check that the server is reachable. Pass an optional message and get it echoed back.",
    { message: z.string().optional().describe("Optional message to echo") },
    async ({ message }) => ({
      content: [
        {
          type: "text" as const,
          text: message
            ? `pong — you said: "${message}"`
            : "pong",
        },
      ],
    }),
  );

  return mcp;
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * MCP endpoint — one transport instance per POST (stateless).
 */
app.post("/mcp", async (req, res) => {
  // Stateless: omit sessionIdGenerator entirely
  const transport = new StreamableHTTPServerTransport();
  const mcp = buildMcpServer();

  try {
    // Cast needed: SDK getter types diverge from the Transport interface under
    // exactOptionalPropertyTypes — this is a known SDK type quirk, not a runtime issue.
    await mcp.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    // Best-effort cleanup; ignore errors on teardown
    res.on("finish", () => {
      void mcp.close();
    });
  }
});

// Health check (plain HTTP, not MCP)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "ripple-mcp", version: "0.1.0" });
});

app.listen(PORT, () => {
  console.log(`Ripple MCP server listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint : POST http://localhost:${PORT}/mcp`);
  console.log(`  Health check : GET  http://localhost:${PORT}/health`);
});
