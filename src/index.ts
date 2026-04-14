import "dotenv/config";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import QRCode from "qrcode";

import { tools, handleWhatsAppTool } from "./tools.js";
import {
  WhatsAppClient,
  warmClient,
  getCurrentQR,
  isClientReady,
} from "./clients/whatsapp.js";

// --setup mode: local QR scan, then exit
if (process.argv.includes("--setup")) {
  const client = new WhatsAppClient();
  await client.ensureLoggedIn();
  console.error("Setup complete. You can now run the server normally.");
  process.exit(0);
}

// ── HTTP server ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Health check — Railway uses this to know the service is up
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    whatsapp_ready: isClientReady(),
    timestamp: new Date().toISOString(),
  });
});

// Setup page — visit this on Railway to scan the QR code once
app.get("/setup", async (_req, res) => {
  const qr = getCurrentQR();

  if (isClientReady()) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>✅ WhatsApp Connected</h1>
        <p>Your session is active. Claude can now use your WhatsApp.</p>
      </body></html>
    `);
  }

  if (!qr) {
    return res.send(`
      <html>
        <head><meta http-equiv="refresh" content="3"></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px">
          <h1>⏳ Starting up...</h1>
          <p>WhatsApp is connecting. This page will refresh automatically.</p>
        </body>
      </html>
    `);
  }

  const qrImage = await QRCode.toDataURL(qr);
  res.send(`
    <html>
      <head>
        <title>WhatsApp Setup</title>
        <meta http-equiv="refresh" content="20">
      </head>
      <body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>📱 Scan QR Code</h1>
        <p>Open WhatsApp on your phone → Menu (⋮) → Linked Devices → Link a Device</p>
        <img src="${qrImage}" style="width:280px;height:280px;border:2px solid #ccc;border-radius:8px" />
        <p style="color:#888;font-size:14px">Page refreshes every 20s. Once scanned this will show "Connected".</p>
      </body>
    </html>
  `);
});

// ── MCP over SSE ───────────────────────────────────────────────────────────────

function buildMCPServer() {
  const server = new Server(
    { name: "whatsapp-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;
      const result = await handleWhatsAppTool(name, args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Track active SSE transports so POST /messages can route to the right one
const activeTransports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  activeTransports.set(transport.sessionId, transport);

  res.on("close", () => {
    activeTransports.delete(transport.sessionId);
  });

  const server = buildMCPServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.error(`WhatsApp MCP Server listening on port ${PORT}`);
  console.error(`  Health:  http://localhost:${PORT}/health`);
  console.error(`  Setup:   http://localhost:${PORT}/setup`);
  console.error(`  MCP SSE: http://localhost:${PORT}/sse`);

  // Begin WhatsApp browser initialization immediately in the background
  warmClient();
});
