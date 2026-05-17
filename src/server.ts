import http from "node:http";
import { getRequiredEnv } from "./agentphone.js";
import {
  headerValue,
  readRequestBody,
  sendJson,
  sendResponse,
} from "./node-http.js";
import {
  handleAgentPhoneWebhook,
  parseAgentPhoneWebhook,
  verifyAgentPhoneWebhook,
} from "./webhook.js";

const port = Number(process.env.PORT ?? 3000);
const webhookSecret = getRequiredEnv("AGENTPHONE_WEBHOOK_SECRET");

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook/agentphone") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const rawBody = await readRequestBody(req);
  const verified = verifyAgentPhoneWebhook(
    rawBody,
    {
      signature: headerValue(req.headers["x-webhook-signature"]),
      timestamp: headerValue(req.headers["x-webhook-timestamp"]),
    },
    webhookSecret,
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
});

server.listen(port, () => {
  console.log(`AgentPhone webhook server listening on http://localhost:${port}`);
});
