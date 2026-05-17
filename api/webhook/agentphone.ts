import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequiredEnv } from "../../src/agentphone.js";
import {
  headerValue,
  readRequestBody,
  sendJson,
  sendResponse,
} from "../../src/node-http.js";
import {
  handleAgentPhoneWebhook,
  parseAgentPhoneWebhook,
  verifyAgentPhoneWebhook,
} from "../../src/webhook.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const rawBody = await readRequestBody(req);
  const verified = verifyAgentPhoneWebhook(
    rawBody,
    {
      signature: headerValue(req.headers["x-webhook-signature"]),
      timestamp: headerValue(req.headers["x-webhook-timestamp"]),
    },
    getRequiredEnv("AGENTPHONE_WEBHOOK_SECRET"),
  );

  if (!verified) {
    sendJson(res, 401, { error: "Invalid webhook signature" });
    return;
  }

  try {
    const payload = parseAgentPhoneWebhook(rawBody);
    const response = await handleAgentPhoneWebhook(payload, {
      webhookId: headerValue(req.headers["x-webhook-id"]),
    });
    await sendResponse(res, response);
  } catch (error) {
    console.error("AgentPhone webhook failed", error);
    sendJson(res, 400, { error: "Invalid webhook payload" });
  }
}
