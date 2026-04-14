# WhatsApp MCP Server

Standalone MCP server for WhatsApp monitoring via Playwright.

## Setup

No credentials needed! Just run the server, scan the QR code once with your phone, and the browser session is saved locally.

## Build

```bash
npm install
npx playwright install chromium
npm run build
```

## Run

```bash
npm start
```

On first run, a browser window will open with a QR code. Scan it with WhatsApp on your phone. After that, the session is remembered.

## Tools Available

- `whatsapp_get_unread` - Get all unread messages with full details
- `whatsapp_get_contacts_with_unread` - Lightweight: just contacts + counts
