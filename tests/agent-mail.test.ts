import { describe, expect, test } from "bun:test";

import { AgentMailModule } from "../src/modules/agent-mail";

type SendRequest = {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  labels?: string[];
};

function createFakeClient(options?: {
  send?: (inboxId: string, request: SendRequest) => Promise<unknown>;
  list?: (
    inboxId: string,
    request?: { limit?: number; pageToken?: string },
  ) => Promise<{ messages?: unknown[] }>;
  get?: (inboxId: string, messageId: string) => Promise<unknown>;
}) {
  return {
    inboxes: {
      messages: {
        send:
          options?.send ??
          (async () => ({
            messageId: "msg_123",
            threadId: "thr_123",
          })),
        list: options?.list ?? (async () => ({ messages: [] })),
        get: options?.get ?? (async (_inboxId: string, messageId: string) => ({ messageId })),
      },
    },
  };
}

describe("AgentMailModule", () => {
  test("sends demo confirmation from an inbox to a recipient email", async () => {
    const sendCalls: Array<{ inboxId: string; request: SendRequest }> = [];
    const client = createFakeClient({
      send: async (inboxId, request) => {
        sendCalls.push({ inboxId, request });
        return { messageId: "msg_123", threadId: "thr_123" };
      },
    });
    const module = new AgentMailModule({ AGENTMAIL_API_KEY: "unused" }, client);

    const result = await module.sendDemoConfirmation({
      fromInboxId: "agent@agentmail.to",
      toEmail: "demo-restaurant@example.com",
      restaurantName: "Demo Thai",
      orderId: "ord_123",
      pickupTime: "7:30 PM",
      totalUsd: "$84.12",
    });

    expect(result).toEqual({ messageId: "msg_123", threadId: "thr_123" });
    expect(sendCalls[0]?.inboxId).toBe("agent@agentmail.to");
    expect(sendCalls[0]?.request).toMatchObject({
      to: "demo-restaurant@example.com",
      subject: "Order confirmed: Demo Thai",
      labels: ["demo-confirmation"],
    });
  });

  test("uses AGENTMAIL_INBOX_ID when inbox id is omitted", async () => {
    const inboxIds: string[] = [];
    const client = createFakeClient({
      send: async (inboxId) => {
        inboxIds.push(inboxId);
        return { messageId: "msg_123" };
      },
      list: async (inboxId) => {
        inboxIds.push(inboxId);
        return { messages: [] };
      },
      get: async (inboxId) => {
        inboxIds.push(inboxId);
        return { messageId: "msg_456", subject: "Hi" };
      },
    });
    const module = new AgentMailModule(
      { AGENTMAIL_API_KEY: "unused", AGENTMAIL_INBOX_ID: "agent@agentmail.to" },
      client,
    );

    await module.sendDemoConfirmation({
      toEmail: "demo-restaurant@example.com",
      restaurantName: "Demo Thai",
      orderId: "ord_123",
    });
    await module.listMessages();
    await module.getMessage({ messageId: "msg_456" });

    expect(inboxIds).toEqual([
      "agent@agentmail.to",
      "agent@agentmail.to",
      "agent@agentmail.to",
    ]);
  });

  test("lists and retrieves inbox messages", async () => {
    const client = createFakeClient({
      list: async () => ({
        messages: [{ message_id: "msg_456", subject: "Order confirmed: Demo Thai" }],
      }),
      get: async (_inboxId, messageId) => ({
        message_id: messageId,
        subject: "Order confirmed: Demo Thai",
        text: "Your demo order ord_123 is confirmed.",
      }),
    });
    const module = new AgentMailModule({ AGENTMAIL_API_KEY: "unused" }, client);

    const listed = await module.listMessages({ inboxId: "agent@agentmail.to", limit: 10 });
    const message = await module.getMessage({
      inboxId: "agent@agentmail.to",
      messageId: "msg_456",
    });

    expect(listed).toEqual([
      { messageId: "msg_456", subject: "Order confirmed: Demo Thai" },
    ]);
    expect(message).toMatchObject({
      messageId: "msg_456",
      subject: "Order confirmed: Demo Thai",
      text: "Your demo order ord_123 is confirmed.",
    });
  });
});
