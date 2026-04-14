// @ts-nocheck
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurable via env vars — defaults work locally, overridden on Railway
const SESSION_DIR =
  process.env.WHATSAPP_SESSION_DIR ||
  resolve(__dirname, "../../whatsapp-session");

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/Users/tejdeepchippa/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

// In Docker/Railway: WHATSAPP_HEADLESS=true (no display server available)
// Locally: defaults to false (visible browser for debugging)
const USE_HEADLESS = process.env.WHATSAPP_HEADLESS === "true";

// Singleton — one browser for the lifetime of this process
let _client: any = null;
let _initPromise: Promise<void> | null = null;
let _currentQR: string | null = null;
let _isReady = false;

export function getCurrentQR(): string | null {
  return _currentQR;
}

export function isClientReady(): boolean {
  return _isReady;
}

function createClient(forceVisible = false) {
  const headless = forceVisible ? false : USE_HEADLESS;
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-gpu",
  ];

  // Hide window off-screen when running locally without headless
  if (!headless && !forceVisible) {
    args.push("--window-position=-32000,-32000", "--window-size=1,1");
  }

  return new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      headless,
      executablePath: CHROMIUM_PATH,
      args,
    },
  });
}

function clearBrowserLocks() {
  const sessionPath = join(SESSION_DIR, "session");
  for (const f of [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookiesLock",
    ".com.google.Chrome.LOCK",
  ]) {
    try {
      fs.unlinkSync(join(sessionPath, f));
    } catch {
      // file doesn't exist — fine
    }
  }
}

async function getClient(): Promise<any> {
  if (!_client || !_initPromise) {
    // Fallback if warmClient wasn't called at startup
    warmClient();
  }
  await _initPromise;
  return _client;
}

// Clean up on process exit
process.on("exit", () => {
  _client?.destroy();
});
process.on("SIGINT", async () => {
  await _client?.destroy();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await _client?.destroy();
  process.exit(0);
});

/**
 * Start browser initialization immediately at server startup.
 * Tool calls await the already-in-progress promise — no timeout risk.
 */
export function warmClient(): void {
  if (_client) return;

  clearBrowserLocks();
  _client = createClient();
  _isReady = false;
  _currentQR = null;

  _initPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("WhatsApp client timed out after 120s")),
      120_000
    );

    _client.on("qr", (qr: string) => {
      _currentQR = qr;
      console.error("QR code ready — visit /setup to scan it");
    });

    _client.on("authenticated", () => {
      _currentQR = null;
      console.error("WhatsApp authenticated, loading session...");
    });

    _client.on("ready", () => {
      clearTimeout(timeout);
      _currentQR = null;
      _isReady = true;
      console.error("WhatsApp ready.");
      resolve();
    });

    _client.on("auth_failure", (msg: string) => {
      clearTimeout(timeout);
      _client = null;
      _initPromise = null;
      _isReady = false;
      console.error(`WhatsApp auth failure: ${msg}`);
      reject(new Error(`Auth failed: ${msg}`));
    });

    _client.initialize();
  });

  _initPromise.catch((err) => {
    console.error("WhatsApp warm-up failed:", err.message);
  });
}

export class WhatsAppClient {
  async getUnreadMessages() {
    const client = await getClient();

    let chats: any[];
    try {
      chats = await client.getChats();
    } catch (e: any) {
      throw new Error(`getChats() failed: ${e?.message || e}`);
    }

    const withUnread = chats.filter((c: any) => c.unreadCount > 0 && !c.archived);
    const unread = withUnread
      .map((c: any) => ({
        name: c.name,
        unread_count: c.unreadCount,
        is_group: c.isGroup,
      }))
      .sort((a: any, b: any) => b.unread_count - a.unread_count);

    return {
      total_unread: unread.reduce((s: number, c: any) => s + c.unread_count, 0),
      conversations: unread,
      check_timestamp: new Date().toISOString(),
      status: "success",
    };
  }

  async getContactsWithUnread() {
    const client = await getClient();

    let chats: any[];
    try {
      chats = await client.getChats();
    } catch (e: any) {
      throw new Error(`getChats() failed: ${e?.message || e}`);
    }

    const contacts = chats
      .filter((c: any) => c.unreadCount > 0 && !c.archived)
      .map((c: any) => ({ name: c.name, count: c.unreadCount }))
      .sort((a: any, b: any) => b.count - a.count);

    return {
      unread: contacts,
      total: contacts.reduce((s: number, c: any) => s + c.count, 0),
      checked_at: new Date().toISOString(),
      status: "success",
    };
  }

  // --setup: open visible browser, display QR, wait for user to confirm sync
  async ensureLoggedIn() {
    const client = createClient(true); // always visible for QR scan

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Setup timed out after 5 minutes")),
        300_000
      );

      client.on("qr", () => {
        console.error("QR code shown in browser — scan it with WhatsApp.");
        console.error("  WhatsApp → ⋮ Menu → Linked Devices → Link a Device");
      });

      client.on("authenticated", () => {
        console.error("\n✅ Authenticated! Saving session...");
      });

      client.on("ready", async () => {
        clearTimeout(timeout);
        console.error("\n✅ Logged in! Messages are syncing in the browser.");
        console.error(
          "   Watch the browser — when your chats are fully loaded, press ENTER.\n"
        );

        await new Promise<void>((r) => {
          process.stdin.setRawMode?.(false);
          process.stdin.resume();
          process.stdin.once("data", () => r());
        });

        console.error("✅ Session saved to " + SESSION_DIR);
        await client.destroy();
        resolve();
      });

      client.on("auth_failure", (msg) => {
        clearTimeout(timeout);
        reject(new Error(`Auth failed: ${msg}`));
      });

      client.initialize();
    });
  }
}
