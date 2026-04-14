// @ts-nocheck
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSION_DIR =
  process.env.WHATSAPP_SESSION_DIR ||
  resolve(__dirname, "../../whatsapp-session");

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/Users/tejdeepchippa/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const USE_HEADLESS = process.env.WHATSAPP_HEADLESS === "true";

const log = (...args: any[]) => console.error("[WA]", ...args);

// Singleton
let _client: any = null;
let _initPromise: Promise<void> | null = null;
let _currentQR: string | null = null;
let _isReady = false;
let _ackResolve: (() => void) | null = null;
let _pendingAck = false;

// ── Exports ────────────────────────────────────────────────────────────────────

export function getCurrentQR() { return _currentQR; }
export function isClientReady() { return _isReady; }
export function isPendingAck() { return _pendingAck; }

export function acknowledgeSync() {
  log("acknowledgeSync() called");
  _pendingAck = false;
  _isReady = true;
  _ackResolve?.();
  _ackResolve = null;
}

export async function getDebugState() {
  const hasPupPage = !!_client?.pupPage;
  const hasPupBrowser = !!_client?.pupBrowser;
  let pageUrl = "N/A";
  let pageCount = 0;
  let browserConnected = false;
  let screenshotOk = false;
  let chatCount = 0;

  try {
    if (_client?.pupPage) {
      pageUrl = await _client.pupPage.url();
    }
  } catch (e) { pageUrl = `error: ${e.message}`; }

  try {
    if (_client?.pupBrowser) {
      const pages = await _client.pupBrowser.pages();
      pageCount = pages.length;
      browserConnected = _client.pupBrowser.isConnected();
    }
  } catch (e) { pageCount = -1; }

  try {
    const buf = await takeScreenshot();
    screenshotOk = buf !== null;
  } catch { screenshotOk = false; }

  if (_isReady) {
    try {
      const chats = await _client.getChats();
      chatCount = chats.length;
    } catch { chatCount = -1; }
  }

  return {
    isReady: _isReady,
    pendingAck: _pendingAck,
    hasQR: !!_currentQR,
    clientExists: !!_client,
    hasPupPage,
    hasPupBrowser,
    browserConnected,
    pageUrl,
    pageCount,
    screenshotOk,
    chatCount,
    sessionDir: SESSION_DIR,
    headless: USE_HEADLESS,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };
}

export async function takeScreenshot(): Promise<Buffer | null> {
  if (!_client) {
    log("takeScreenshot: no client");
    return null;
  }
  try {
    if (_client.pupPage && !_client.pupPage.isClosed()) {
      const buf = await _client.pupPage.screenshot({ type: "png" });
      return buf;
    }
    log("takeScreenshot: pupPage closed/missing, trying pupBrowser.pages()");
    const pages = await _client.pupBrowser?.pages();
    if (pages?.length) {
      log(`takeScreenshot: got ${pages.length} pages from browser`);
      const buf = await pages[0].screenshot({ type: "png" });
      return buf;
    }
    log("takeScreenshot: no pages found in browser");
  } catch (e) {
    log("takeScreenshot error:", e.message);
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function createClient(forceVisible = false) {
  const headless = forceVisible ? false : USE_HEADLESS;
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-gpu",
  ];
  if (!headless && !forceVisible) {
    args.push("--window-position=-32000,-32000", "--window-size=1,1");
  }
  log(`createClient: headless=${headless}, chromium=${CHROMIUM_PATH}`);
  return new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: { headless, executablePath: CHROMIUM_PATH, args },
  });
}

function clearBrowserLocks() {
  const sessionPath = join(SESSION_DIR, "session");
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookiesLock", ".com.google.Chrome.LOCK"]) {
    try { fs.unlinkSync(join(sessionPath, f)); log(`cleared lock: ${f}`); }
    catch { /* fine */ }
  }
}

async function getClient(): Promise<any> {
  if (!_client || !_initPromise) warmClient();
  await _initPromise;
  return _client;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

process.on("exit", () => { _client?.destroy(); });
process.on("SIGINT", async () => { await _client?.destroy(); process.exit(0); });
process.on("SIGTERM", async () => { await _client?.destroy(); process.exit(0); });

export function warmClient(): void {
  if (_client) { log("warmClient: already started, skipping"); return; }

  log("warmClient: starting...");
  log(`  SESSION_DIR = ${SESSION_DIR}`);
  log(`  CHROMIUM_PATH = ${CHROMIUM_PATH}`);
  log(`  USE_HEADLESS = ${USE_HEADLESS}`);

  clearBrowserLocks();
  _client = createClient();
  _isReady = false;
  _currentQR = null;

  _initPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      log("ERROR: timed out after 3 minutes");
      reject(new Error("WhatsApp client timed out after 3 minutes"));
    }, 180_000);

    // Log every known event for full visibility
    for (const ev of ["loading_screen", "qr", "authenticated", "auth_failure", "ready", "disconnected", "change_state", "remote_session_saved", "message"]) {
      _client.on(ev, (...args: any[]) => {
        if (ev === "qr") {
          log(`EVENT: qr (new QR generated)`);
        } else if (ev === "message") {
          // skip — too noisy
        } else {
          log(`EVENT: ${ev}`, JSON.stringify(args).slice(0, 300));
        }
        // After each event, log page/browser state
        if (ev !== "message") {
          const pupPageExists = !!_client?.pupPage;
          const pupPageClosed = _client?.pupPage?.isClosed?.() ?? "N/A";
          const browserConnected = _client?.pupBrowser?.isConnected?.() ?? "N/A";
          log(`  → pupPage exists: ${pupPageExists}, isClosed: ${pupPageClosed}, browser connected: ${browserConnected}`);
        }
      });
    }

    _client.on("qr", (qr: string) => {
      _currentQR = qr;
    });

    _client.on("authenticated", () => {
      _currentQR = null;
    });

    _client.on("disconnected", (reason: string) => {
      log(`DISCONNECTED: ${reason} — resetting client`);
      _client = null;
      _initPromise = null;
      _isReady = false;
    });

    _client.on("ready", async () => {
      clearTimeout(timeout);
      _currentQR = null;
      _pendingAck = true;
      log("ready — browser staying open, waiting for /ack");

      // Log page state every 10s while waiting for ack
      const interval = setInterval(async () => {
        const pupPageOk = !!_client?.pupPage && !_client?.pupPage?.isClosed();
        const browserOk = _client?.pupBrowser?.isConnected();
        log(`[heartbeat] pupPage ok: ${pupPageOk}, browser connected: ${browserOk}, pendingAck: ${_pendingAck}, isReady: ${_isReady}`);
      }, 10_000);

      await new Promise<void>((res) => { _ackResolve = res; });
      clearInterval(interval);

      log("ack received — marking ready");
      resolve();
    });

    _client.on("auth_failure", (msg: string) => {
      clearTimeout(timeout);
      log(`AUTH FAILURE: ${msg}`);
      _client = null;
      _initPromise = null;
      _isReady = false;
      reject(new Error(`Auth failed: ${msg}`));
    });

    log("calling client.initialize()...");
    _client.initialize();
  });

  _initPromise.catch((err) => {
    log("warm-up failed:", err.message);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class WhatsAppClient {
  async getUnreadMessages() {
    log("getUnreadMessages() called");
    const client = await getClient();
    log("got client, calling getChats()...");
    let chats: any[];
    try {
      chats = await client.getChats();
    } catch (e: any) {
      throw new Error(`getChats() failed: ${e?.message || e}`);
    }
    log(`getChats() returned ${chats.length} chats`);
    const withUnread = chats.filter((c: any) => c.unreadCount > 0 && !c.archived);
    const unread = withUnread
      .map((c: any) => ({ name: c.name, unread_count: c.unreadCount, is_group: c.isGroup }))
      .sort((a: any, b: any) => b.unread_count - a.unread_count);
    return {
      total_unread: unread.reduce((s: number, c: any) => s + c.unread_count, 0),
      conversations: unread,
      check_timestamp: new Date().toISOString(),
      status: "success",
    };
  }

  async getContactsWithUnread() {
    log("getContactsWithUnread() called");
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

  async ensureLoggedIn() {
    const client = createClient(true);
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Setup timed out after 5 minutes")), 300_000);
      client.on("qr", () => {
        console.error("QR code shown in browser — scan it with WhatsApp.");
      });
      client.on("authenticated", () => {
        console.error("✅ Authenticated! Saving session...");
      });
      client.on("ready", async () => {
        clearTimeout(timeout);
        console.error("✅ Logged in! Press ENTER when chats are fully loaded.");
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
