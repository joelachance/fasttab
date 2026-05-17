import crypto from "node:crypto";

import { AgentPhoneClient } from "agentphone";

import { envWithDefault, requiredEnv, type Env } from "./env.js";
import { OrderSessionStore } from "./foodrun/order-session-store.js";
import {
  handleFoodrunTextMessage,
  type FoodrunTextIntakeResult,
  type FoodrunTextMessage,
} from "./foodrun/text-intake.js";

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type AgentPhoneChannel = "sms" | "mms" | "imessage" | "voice";
export type AgentPhoneTextChannel = Exclude<AgentPhoneChannel, "voice">;

export type AgentPhoneWebhookPayload =
  | AgentPhoneMessageWebhook
  | AgentPhoneReactionWebhook
  | AgentPhoneCallEndedWebhook;

export type AgentPhoneMessageWebhook = {
  event: "agent.message";
  channel: AgentPhoneChannel;
  timestamp?: string;
  agentId: string;
  data: Record<string, unknown>;
  conversationState?: Record<string, unknown> | null;
  recentHistory?: Array<Record<string, unknown>>;
};

export type AgentPhoneReactionWebhook = {
  event: "agent.reaction";
  channel: "imessage";
  timestamp?: string;
  agentId: string;
  data: Record<string, unknown>;
  conversationState?: Record<string, unknown> | null;
  recentHistory?: Array<Record<string, unknown>>;
};

export type AgentPhoneCallEndedWebhook = {
  event: "agent.call_ended";
  channel: "voice";
  timestamp?: string;
  agentId: string;
  data: Record<string, unknown>;
  conversationState?: Record<string, unknown> | null;
  recentHistory?: Array<Record<string, unknown>>;
};

export type WebhookHeaders = {
  signature?: string;
  timestamp?: string;
};

export type AgentPhoneTextSender = {
  sendText(input: {
    agentId: string;
    toNumber: string;
    body: string;
    numberId?: string;
  }): Promise<unknown>;
};

export type AgentPhoneWebhookHandlerOptions = {
  textSender?: AgentPhoneTextSender;
  textIntake?: (input: FoodrunTextMessage) => Promise<FoodrunTextIntakeResult>;
  webhookId?: string;
  webhookStore?: Pick<OrderSessionStore, "recordWebhookDelivery">;
  env?: Env;
};

class AgentPhoneSdkTextSender implements AgentPhoneTextSender {
  private readonly client: AgentPhoneClient;

  constructor(private readonly env: Env = process.env) {
    this.client = new AgentPhoneClient({
      token: requiredEnv(env, "AGENTPHONE_API_KEY"),
      baseUrl: agentPhoneApiBase(env),
    });
  }

  sendText(input: {
    agentId: string;
    toNumber: string;
    body: string;
    numberId?: string;
  }): Promise<unknown> {
    const request = {
      agent_id: input.agentId,
      to_number: input.toNumber,
      body: input.body,
      number_id: input.numberId,
    };

    return this.client.messages.sendMessage(request);
  }
}

export function verifyAgentPhoneWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
): boolean {
  if (!headers.signature || !headers.timestamp) {
    return false;
  }

  const timestampSeconds = Number(headers.timestamp);

  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Date.now() / 1000;

  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const expectedDigest = crypto
    .createHmac("sha256", secret)
    .update(`${headers.timestamp}.${rawBody}`)
    .digest("hex");
  const expectedSignature = `sha256=${expectedDigest}`;

  return timingSafeEqual(headers.signature, expectedSignature);
}

export function parseAgentPhoneWebhook(rawBody: string): AgentPhoneWebhookPayload {
  const payload = JSON.parse(rawBody) as AgentPhoneWebhookPayload;

  if (!payload || typeof payload !== "object" || !("event" in payload)) {
    throw new Error("Invalid AgentPhone webhook payload");
  }

  return payload;
}

export async function handleAgentPhoneWebhook(
  payload: AgentPhoneWebhookPayload,
  options: AgentPhoneWebhookHandlerOptions = {},
): Promise<Response> {
  if (payload.event === "agent.call_ended") {
    console.log("Ignoring AgentPhone call event for text-only agent", {
      agentId: payload.agentId,
      callId: payload.data.callId,
      durationSeconds: payload.data.durationSeconds,
    });
    return Response.json({ ok: true, ignored: true });
  }

  if (payload.event === "agent.reaction") {
    console.log("AgentPhone reaction", {
      agentId: payload.agentId,
      reactionType: payload.data.reactionType,
      messageId: payload.data.messageId,
    });
    return Response.json({ ok: true });
  }

  if (!isTextChannel(payload.channel)) {
    console.log("Ignoring non-text AgentPhone message", {
      agentId: payload.agentId,
      channel: payload.channel,
    });
    return Response.json({ ok: true, ignored: true });
  }

  const direction = stringField(payload.data, "direction");

  if (direction && direction !== "inbound") {
    console.log("Ignoring non-inbound AgentPhone message", {
      agentId: payload.agentId,
      channel: payload.channel,
      direction,
      conversationId: payload.data.conversationId,
    });
    return Response.json({ ok: true, ignored: true, reason: "outbound" });
  }

  const fromNumber = stringField(payload.data, "from", "fromNumber", "from_number");
  const numberId = stringField(
    payload.data,
    "phoneNumberId",
    "phone_number_id",
    "numberId",
    "number_id",
  );

  if (!fromNumber) {
    return Response.json({ ok: true, ignored: true });
  }

  const body = extractInboundMessageText(payload.data, payload.recentHistory);
  const roomId = stringField(payload.data, "conversationId", "conversation_id") ?? `${payload.agentId}-${fromNumber}`;
  const messageId = stringField(payload.data, "messageId", "message_id");

  console.log("AgentPhone message", {
    agentId: payload.agentId,
    channel: payload.channel,
    from: fromNumber,
    conversationId: roomId,
    direction: direction ?? "inbound",
    bodyLength: body.length,
  });

  if (!body.trim()) {
    console.log("Ignoring AgentPhone message with no text content", {
      agentId: payload.agentId,
      conversationId: roomId,
    });
    return Response.json({ ok: true, ignored: true, reason: "empty_message" });
  }

  const webhookStore = options.webhookStore ?? new OrderSessionStore(options.env);

  if (options.webhookId) {
    const isNew = await webhookStore.recordWebhookDelivery({
      webhookId: options.webhookId,
      eventType: payload.event,
      roomId,
      payload: {
        channel: payload.channel,
        messageId,
        fromNumber,
      },
    });

    if (!isNew) {
      return Response.json({ ok: true, duplicate: true });
    }
  }

  let reply = "Hi, this is your FastTab agent. What would you like to order?";

  try {
    const intake = await (options.textIntake ?? handleFoodrunTextMessage)({
      roomId,
      agentId: payload.agentId,
      fromNumber,
      agentNumberId: numberId,
      body,
      messageId,
      channel: payload.channel,
    });
    reply = intake.reply;
  } catch (error) {
    console.error("FastTab text intake failed", error);
  }

  const sender = options.textSender ?? new AgentPhoneSdkTextSender(options.env);

  try {
    await sender.sendText({
      agentId: payload.agentId,
      toNumber: fromNumber,
      body: reply,
      numberId,
    });
  } catch (error) {
    console.error("AgentPhone reply failed", error);
    return Response.json({ ok: true, replySent: false });
  }

  return Response.json({ ok: true, replySent: true, response: reply });
}

export function extractInboundMessageText(
  data: Record<string, unknown>,
  recentHistory?: Array<Record<string, unknown>>,
): string {
  const direct = stringField(data, "message", "body", "text", "content", "transcript");

  if (direct) {
    return direct;
  }

  if (!recentHistory?.length) {
    return "";
  }

  for (let index = recentHistory.length - 1; index >= 0; index -= 1) {
    const item = recentHistory[index];
    const itemDirection = typeof item.direction === "string" ? item.direction : undefined;

    if (itemDirection && itemDirection !== "inbound") {
      continue;
    }

    const content = stringField(item, "content", "message", "body", "text");

    if (content) {
      return content;
    }
  }

  return "";
}

function isTextChannel(channel: AgentPhoneChannel): channel is AgentPhoneTextChannel {
  return channel === "sms" || channel === "mms" || channel === "imessage";
}

function stringField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function agentPhoneApiBase(env: Env): string {
  return envWithDefault(env, "AGENTPHONE_API_BASE", "https://api.agentphone.ai").replace(
    /\/v1\/?$/,
    "",
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}
