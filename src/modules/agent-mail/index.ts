import { AgentMailClient } from "agentmail";

import { envWithDefault, requiredEnv, type Env } from "../../env.js";

export type ConfirmationEmail = {
  fromInboxId?: string;
  toEmail: string;
  restaurantName: string;
  orderId: string;
  pickupTime?: string;
  totalUsd?: string;
};

export type SendMessageResult = {
  messageId: string;
  threadId?: string;
};

export type InboxMessage = {
  messageId: string;
  threadId?: string;
  subject?: string;
  text?: string;
  from?: string | string[];
  to?: string | string[];
  labels?: string[];
};

type AgentMailClientLike = {
  inboxes: {
    messages: {
      send(
        inboxId: string,
        request: {
          to?: string;
          subject?: string;
          text?: string;
          html?: string;
          labels?: string[];
        },
      ): Promise<unknown>;
      list(
        inboxId: string,
        request?: { limit?: number; pageToken?: string },
      ): Promise<{ messages?: unknown[] }>;
      get(inboxId: string, messageId: string): Promise<unknown>;
    };
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function normalizeMessage(raw: unknown): InboxMessage {
  const record = asRecord(raw);
  const messageId = stringField(record, "messageId", "message_id");

  if (!messageId) {
    throw new Error("AgentMail message response missing messageId");
  }

  const message: InboxMessage = { messageId };
  const threadId = stringField(record, "threadId", "thread_id");
  const text = stringField(record, "text", "extractedText", "extracted_text");

  if (threadId) {
    message.threadId = threadId;
  }
  if (typeof record.subject === "string") {
    message.subject = record.subject;
  }
  if (text) {
    message.text = text;
  }
  if (typeof record.from === "string" || Array.isArray(record.from)) {
    message.from = record.from as string | string[];
  }
  if (typeof record.to === "string" || Array.isArray(record.to)) {
    message.to = record.to as string | string[];
  }
  if (Array.isArray(record.labels)) {
    message.labels = record.labels as string[];
  }

  return message;
}

function normalizeSendResult(raw: unknown): SendMessageResult {
  const record = asRecord(raw);
  const messageId = stringField(record, "messageId", "message_id");

  if (!messageId) {
    throw new Error("AgentMail send response missing messageId");
  }

  const result: SendMessageResult = { messageId };
  const threadId = stringField(record, "threadId", "thread_id");

  if (threadId) {
    result.threadId = threadId;
  }

  return result;
}

export class AgentMailModule {
  private readonly client: AgentMailClientLike;
  private readonly defaultInboxId?: string;

  constructor(env: Env = process.env, client?: AgentMailClientLike) {
    this.defaultInboxId = env.AGENTMAIL_INBOX_ID;
    this.client =
      client ??
      new AgentMailClient({
        apiKey: requiredEnv(env, "AGENTMAIL_API_KEY"),
        baseUrl: envWithDefault(env, "AGENTMAIL_API_BASE", "https://api.agentmail.to"),
      });
  }

  private inboxId(override?: string): string {
    const id = override ?? this.defaultInboxId;

    if (!id) {
      throw new Error("Missing inbox id: set AGENTMAIL_INBOX_ID or pass inboxId");
    }

    return id;
  }

  async sendDemoConfirmation(input: ConfirmationEmail): Promise<SendMessageResult> {
    const text = [
      `Your demo order ${input.orderId} is confirmed.`,
      input.pickupTime ? `Pickup time: ${input.pickupTime}` : undefined,
      input.totalUsd ? `Total: ${input.totalUsd}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const sent = await this.client.inboxes.messages.send(this.inboxId(input.fromInboxId), {
      to: input.toEmail,
      subject: `Order confirmed: ${input.restaurantName}`,
      text,
      labels: ["demo-confirmation"],
    });

    return normalizeSendResult(sent);
  }

  async listMessages(input?: {
    inboxId?: string;
    limit?: number;
    pageToken?: string;
  }): Promise<InboxMessage[]> {
    const listed = await this.client.inboxes.messages.list(this.inboxId(input?.inboxId), {
      limit: input?.limit,
      pageToken: input?.pageToken,
    });

    return (listed.messages ?? []).map(normalizeMessage);
  }

  async getMessage(input: { messageId: string; inboxId?: string }): Promise<InboxMessage> {
    const message = await this.client.inboxes.messages.get(
      this.inboxId(input.inboxId),
      input.messageId,
    );

    return normalizeMessage(message);
  }
}
