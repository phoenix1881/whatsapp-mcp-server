// Direct test — bypasses MCP pipe, calls WhatsApp client methods directly
import { WhatsAppClient } from "./dist/clients/whatsapp.js";

const client = new WhatsAppClient();

console.log("\n💬 Test 1: getContactsWithUnread");
console.log("-----------------------------------");
try {
  const result = await client.getContactsWithUnread();
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("Error:", e.message);
}

console.log("\n📨 Test 2: getUnreadMessages");
console.log("-----------------------------------");
try {
  const result = await client.getUnreadMessages();
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("Error:", e.message);
}

process.exit(0);
