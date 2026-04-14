import { WhatsAppClient } from "./clients/whatsapp.js";

const whatsappClient = new WhatsAppClient();

export const tools = [
  {
    name: "whatsapp_get_unread",
    description: "Get unread message counts from WhatsApp Web (with details)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_get_contacts_with_unread",
    description: "Get contacts with unread counts (lightweight version)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export async function handleWhatsAppTool(name: string, args: any) {
  switch (name) {
    case "whatsapp_get_unread":
      return await whatsappClient.getUnreadMessages();

    case "whatsapp_get_contacts_with_unread":
      return await whatsappClient.getContactsWithUnread();

    default:
      throw new Error(`Unknown WhatsApp tool: ${name}`);
  }
}
