import "dotenv/config";
import express from "express";
import { WhatsAppClient, warmClient, getCurrentQR, isClientReady } from "./clients/whatsapp.js";
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

// Visit this on Railway to scan QR once
app.get("/setup", async (_req, res) => {
  if (isClientReady()) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>✅ WhatsApp Connected</h1>
        <p>Your session is active.</p>
      </body></html>
    `);
  }
  const qr = getCurrentQR();
  if (!qr) {
    return res.send(`
      <html>
        <head><meta http-equiv="refresh" content="3"></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px">
          <h1>⏳ Starting up...</h1><p>Refresh in a few seconds.</p>
        </body>
      </html>
    `);
  }
  const qrImage = await QRCode.toDataURL(qr);
  res.send(`
    <html>
      <head><title>WhatsApp Setup</title><meta http-equiv="refresh" content="20"></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>📱 Scan QR Code</h1>
        <p>WhatsApp → Menu (⋮) → Linked Devices → Link a Device</p>
        <img src="${qrImage}" style="width:280px;height:280px;border:2px solid #ccc;border-radius:8px"/>
        <p style="color:#888;font-size:14px">Auto-refreshes every 20s</p>
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
