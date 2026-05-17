import "../src/env.js";

import { BrowserUse } from "browser-use-sdk/v3";

import { requiredEnv } from "../src/env.js";

const sessionId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (!sessionId) {
  console.error("Usage: bun run browser:session -- <session-id>");
  process.exit(1);
}

const client = new BrowserUse({
  apiKey: requiredEnv(process.env, "BROWSER_USE_API_KEY"),
  baseUrl: process.env.BROWSER_USE_API_BASE,
});
const session = await client.sessions.get(sessionId);

console.log(
  JSON.stringify(
    {
      id: session.id,
      status: session.status,
      isTaskSuccessful: session.isTaskSuccessful,
      stepCount: session.stepCount,
      lastStepSummary: session.lastStepSummary,
      output: session.output,
      liveUrl: session.liveUrl,
      totalCostUsd: session.totalCostUsd,
      screenshotUrl: session.screenshotUrl,
    },
    null,
    2,
  ),
);
