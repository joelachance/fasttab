import type { IncomingMessage, ServerResponse } from "node:http";

import { processFoodrunJobs } from "../../src/foodrun/job-worker.js";
import { headerValue, sendJson } from "../../src/node-http.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const secret = process.env.FOODRUN_JOB_SECRET ?? process.env.CRON_SECRET;

  if (secret && headerValue(req.headers.authorization) !== `Bearer ${secret}`) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const result = await processFoodrunJobs();

  sendJson(res, 200, { ok: true, ...result });
}
