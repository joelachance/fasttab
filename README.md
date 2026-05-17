# Fasttab AgentPhone TypeScript Starter

This repo starts with a small TypeScript AgentPhone integration:

- `src/agentphone.ts` creates the official `agentphone` SDK client.
- `src/webhook.ts` verifies AgentPhone webhook signatures and handles the current event types.
- `src/server.ts` runs a local raw-body webhook endpoint at `/webhook/agentphone`.
- `api/webhook/agentphone.ts` exposes the same webhook handler as a Vercel serverless function.
- `src/provision.ts` creates or reuses an agent and registers the project webhook.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `AGENTPHONE_API_KEY` first. If you already have an AgentPhone number, set `AGENTPHONE_NUMBER_ID` to that number's ID and leave `AGENTPHONE_PROVISION_NUMBER=false`.

Then expose the local server with ngrok or deploy to Vercel, set `AGENTPHONE_WEBHOOK_URL`, and run:

```bash
npm run setup:agentphone
```

The setup script prints the webhook secret once. Save it as `AGENTPHONE_WEBHOOK_SECRET`.

Set `AGENTPHONE_PROVISION_NUMBER=true` before running setup if you want the script to buy a phone number and attach it to the agent. The default is `false` so local setup does not accidentally create a billable number.

## Vercel

This repo includes `vercel.json`, which rewrites:

```text
/health -> /api/health
/webhook/agentphone -> /api/webhook/agentphone
```

After deploying, set your AgentPhone webhook URL to:

```text
https://your-vercel-domain.vercel.app/webhook/agentphone
```

Configure these Vercel environment variables:

```text
AGENTPHONE_API_KEY
AGENTPHONE_WEBHOOK_SECRET
AGENTPHONE_WEBHOOK_URL
AGENTPHONE_AGENT_ID
AGENTPHONE_NUMBER_ID
AGENTPHONE_PROVISION_NUMBER=false
```

`AGENTPHONE_WEBHOOK_SECRET` comes from the AgentPhone webhook setup response. If you do not have it yet, run `npm run setup:agentphone` after setting `AGENTPHONE_WEBHOOK_URL` to your Vercel URL, then copy the printed secret into Vercel.

Use `/health` to verify the deployment is reachable before registering the webhook.

## Local Webhook Server

```bash
npm run dev:webhook
```

The server expects AgentPhone to call:

```text
POST /webhook/agentphone
```

For voice turns, the sample response echoes the transcript as spoken text. For SMS, reactions, and call-ended events, it acknowledges quickly and logs the delivery metadata.

## Notes

- Keep `AGENTPHONE_API_KEY` and `AGENTPHONE_WEBHOOK_SECRET` server-side only.
- Signature verification uses the exact raw request body, so do not put JSON parsing middleware before verification when this is moved into a framework.
- Store and check `X-Webhook-ID` in a database or cache before doing side effects in production, because webhook retries can duplicate deliveries.
