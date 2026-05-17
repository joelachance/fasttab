import crypto from "node:crypto";

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type AgentPhoneChannel = "sms" | "mms" | "imessage" | "voice";

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

export type VoiceWebhookResponse = {
  text: string;
  hangup?: boolean;
  action?: "transfer" | "hangup";
  digits?: string;
};

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
): Promise<Response> {
  if (payload.event === "agent.call_ended") {
    console.log("AgentPhone call ended", {
      agentId: payload.agentId,
      callId: payload.data.callId,
      durationSeconds: payload.data.durationSeconds,
    });
    return Response.json({ ok: true });
  }

  if (payload.event === "agent.reaction") {
    console.log("AgentPhone reaction", {
      agentId: payload.agentId,
      reactionType: payload.data.reactionType,
      messageId: payload.data.messageId,
    });
    return Response.json({ ok: true });
  }

  if (payload.channel === "voice") {
    const response: VoiceWebhookResponse = {
      text: buildVoiceReply(payload),
    };
    return Response.json(response);
  }

  console.log("AgentPhone message", {
    agentId: payload.agentId,
    channel: payload.channel,
    from: payload.data.from,
    conversationId: payload.data.conversationId,
  });

  return Response.json({ ok: true });
}

function buildVoiceReply(payload: AgentPhoneMessageWebhook): string {
  const transcript = payload.data.transcript;

  if (typeof transcript === "string" && transcript.trim()) {
    return `I heard: ${transcript}`;
  }

  return "How can I help?";
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}
