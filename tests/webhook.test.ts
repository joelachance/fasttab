import { describe, expect, test } from "bun:test";

import {
  extractInboundMessageText,
  handleAgentPhoneWebhook,
  type AgentPhoneWebhookPayload,
} from "../src/webhook";

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleAgentPhoneWebhook", () => {
  test("acknowledges text messages", async () => {
    const sent: Array<{ agentId: string; toNumber: string; body: string }> = [];
    const payload: AgentPhoneWebhookPayload = {
      event: "agent.message",
      channel: "sms",
      agentId: "agent_123",
      data: {
        from: "+15551234567",
        phoneNumberId: "num_123",
        conversationId: "conv_123",
        message: "thai food",
        direction: "inbound",
      },
    };

    await expect(
      json(
        await handleAgentPhoneWebhook(payload, {
          textIntake: async (input) => {
            expect(input).toMatchObject({
              roomId: "conv_123",
              agentId: "agent_123",
              fromNumber: "+15551234567",
              agentNumberId: "num_123",
              body: "thai food",
              channel: "sms",
            });
            return {
              reply: "Hi, this is your FastTab agent. What would you like to order?",
              state: "confirming_preferences",
              extracted: {},
            };
          },
          textSender: {
            sendText: async (input) => {
              sent.push(input);
            },
          },
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      replySent: true,
      response: "Hi, this is your FastTab agent. What would you like to order?",
    });
    expect(sent).toEqual([
      {
        agentId: "agent_123",
        toNumber: "+15551234567",
        numberId: "num_123",
        body: "Hi, this is your FastTab agent. What would you like to order?",
      },
    ]);
  });

  test("ignores voice messages for text-only mode", async () => {
    const payload: AgentPhoneWebhookPayload = {
      event: "agent.message",
      channel: "voice",
      agentId: "agent_123",
      data: {
        transcript: "hello",
      },
    };

    await expect(json(await handleAgentPhoneWebhook(payload))).resolves.toEqual({
      ok: true,
      ignored: true,
    });
  });

  test("acknowledges text messages when reply sending fails", async () => {
    const payload: AgentPhoneWebhookPayload = {
      event: "agent.message",
      channel: "sms",
      agentId: "agent_123",
      data: {
        from: "+15551234567",
        message: "thai food",
        direction: "inbound",
      },
    };

    await expect(
      json(
        await handleAgentPhoneWebhook(payload, {
          textIntake: async () => ({
            reply: "Hi, this is your FastTab agent. What would you like to order?",
            state: "confirming_preferences",
            extracted: {},
          }),
          textSender: {
            sendText: async () => {
              throw new Error("send failed");
            },
          },
        }),
      ),
    ).resolves.toEqual({ ok: true, replySent: false });
  });

  test("ignores outbound message echoes", async () => {
    const sent: unknown[] = [];
    const payload: AgentPhoneWebhookPayload = {
      event: "agent.message",
      channel: "imessage",
      agentId: "agent_123",
      data: {
        from: "+15551234567",
        conversationId: "conv_123",
        message: "Hi, this is your FastTab agent. What would you like to order?",
        direction: "outbound",
      },
    };

    await expect(
      json(
        await handleAgentPhoneWebhook(payload, {
          textSender: {
            sendText: async (input) => {
              sent.push(input);
            },
          },
        }),
      ),
    ).resolves.toEqual({ ok: true, ignored: true, reason: "outbound" });
    expect(sent).toEqual([]);
  });

  test("reads inbound text from recentHistory when message field is empty", async () => {
    expect(
      extractInboundMessageText(
        { direction: "inbound" },
        [{ content: "Thai near Mission", direction: "inbound", channel: "imessage" }],
      ),
    ).toBe("Thai near Mission");
  });

  test("ignores call-ended events for text-only mode", async () => {
    const payload: AgentPhoneWebhookPayload = {
      event: "agent.call_ended",
      channel: "voice",
      agentId: "agent_123",
      data: {
        callId: "call_123",
      },
    };

    await expect(json(await handleAgentPhoneWebhook(payload))).resolves.toEqual({
      ok: true,
      ignored: true,
    });
  });
});
