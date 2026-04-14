import "dotenv/config";
import express from "express";
import { WhatsAppClient, warmClient, getCurrentQR, isClientReady, takeScreenshot } from "./clients/whatsapp.js";
import QRCode from "qrcode";

// --setup mode: local QR scan, then exit
if (process.argv.includes("--setup")) {
  const c = new WhatsAppClient();
  await c.ensureLoggedIn();
  console.error("Setup complete. You can now run the server normally.");
  process.exit(0);
}

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const client = new WhatsAppClient();

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", whatsapp_ready: isClientReady() });
});

// Live browser view — shows exactly what headless Chromium sees
app.get("/screenshot", async (_req, res) => {
  const buf = await takeScreenshot();
  if (!buf) {
    return res.status(503).send("Browser not started yet");
  }
  res.setHeader("Content-Type", "image/png");
  res.send(buf);
});

// Setup page — auto-refreshing live view of the browser
app.get("/setup", async (_req, res) => {
  const status = isClientReady() ? "✅ Connected & synced" : getCurrentQR() ? "📱 QR code visible — scan now" : "⏳ Starting up...";
  res.send(`
    <html>
      <head>
        <title>WhatsApp Setup</title>
        <meta http-equiv="refresh" content="4">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px; background: #111; color: #eee; }
          img { border: 2px solid #444; border-radius: 8px; max-width: 100%; margin-top: 20px; }
          .status { font-size: 20px; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <h2>WhatsApp Browser — Live View</h2>
        <div class="status">${status}</div>
        <p style="color:#888;font-size:13px">Auto-refreshes every 4s — you're seeing the actual headless Chromium screen</p>
        <img src="/screenshot?t=${Date.now()}" alt="browser screenshot" />
      </body>
    </html>
  `);
});

// Returns same JSON as the terminal test
app.get("/unread", async (_req, res) => {
  try {
    const result = await client.getUnreadMessages();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/contacts", async (_req, res) => {
  try {
    const result = await client.getContactsWithUnread();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.error(`WhatsApp API running on port ${PORT}`);
  console.error(`  GET /health   → status`);
  console.error(`  GET /setup    → QR code page (first-time auth)`);
  console.error(`  GET /unread   → unread messages JSON`);
  console.error(`  GET /contacts → contacts with unread JSON`);
  warmClient();
});
