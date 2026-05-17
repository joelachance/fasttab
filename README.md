# Fasttab AgentPhone TypeScript Starter

TypeScript starter for wiring Fasttab to AgentPhone with a local webhook server and Vercel-ready serverless endpoints.

## What is here

- `src/modules/agent-mail/` sends demo confirmation emails through the AgentMail SDK.
- `src/modules/sponge/` issues food-order virtual cards through the Sponge SDK.
- `src/modules/supermemory.ts` stores and retrieves food preferences by phone number through the Supermemory SDK.

## Installation

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Set `AGENTPHONE_API_KEY` in `.env.local`.

If you already have an AgentPhone number, set `AGENTPHONE_NUMBER_ID` to that number's ID and keep `AGENTPHONE_PROVISION_NUMBER=false`.

Expose your local webhook server with a public URL, such as ngrok, or deploy the project to Vercel. Then set:

```text
AGENTPHONE_WEBHOOK_URL=https://fasttab.cc/webhook/agentphone
```

Register or reuse the AgentPhone agent and webhook:

```bash
npm run setup:agentphone
```

The setup script prints the webhook secret once. Save it as `AGENTPHONE_WEBHOOK_SECRET` in `.env.local` and in your deployment environment.

Set `AGENTPHONE_PROVISION_NUMBER=true` before running setup only if you want the script to buy a phone number and attach it to the agent. The default is `false` to avoid accidentally creating a billable number during local setup.

## Usage

Run the local webhook server:

```bash
npm run dev:webhook
```

AgentPhone should call:

```text
POST /webhook/agentphone
```

For a local server using the default port, the endpoint is:

```text
http://localhost:3000/webhook/agentphone
```

For a Vercel deployment, use:

```text
https://fasttab.cc/webhook/agentphone
```

The starter webhook:

- Echoes voice-turn transcripts as spoken text.
- Acknowledges SMS, reaction, and call-ended events quickly.
- Logs delivery metadata for received events.

Vercel rewrites are configured in `vercel.json`:

```text
/health -> /api/health
/webhook/agentphone -> /api/webhook/agentphone
```

Use `/health` to verify the deployment is reachable before registering the webhook.

## Configuration

Common environment variables:

```text
AGENTPHONE_API_KEY=your_api_key_here
AGENTPHONE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
AGENTPHONE_WEBHOOK_URL=https://fasttab.cc/webhook/agentphone
AGENTPHONE_AGENT_NAME=Fasttab Agent
AGENTPHONE_AGENT_ID=
AGENTPHONE_NUMBER_ID=
AGENTPHONE_PROVISION_NUMBER=false
PORT=3000
```

Keep `AGENTPHONE_API_KEY` and `AGENTPHONE_WEBHOOK_SECRET` server-side only.

`AGENTPHONE_WEBHOOK_SECRET` comes from the AgentPhone webhook setup response. If you do not have it yet for Vercel, set `AGENTPHONE_WEBHOOK_URL` to the Vercel URL, run `npm run setup:agentphone`, then copy the printed secret into Vercel.

Signature verification uses the exact raw request body. Do not put JSON parsing middleware before verification if you move this handler into a framework.

In production, store and check `X-Webhook-ID` in a database or cache before doing side effects because webhook retries can duplicate deliveries.

## Development

Main files:

- `src/agentphone.ts` creates the official `agentphone` SDK client.
- `src/webhook.ts` verifies AgentPhone webhook signatures and handles supported event types.
- `src/server.ts` runs the local raw-body webhook endpoint at `/webhook/agentphone`.
- `api/webhook/agentphone.ts` exposes the same webhook handler as a Vercel serverless function.
- `src/provision.ts` creates or reuses an agent and registers the project webhook.

Run the local webhook server:

```bash
npm run dev:webhook
```

Run the AgentPhone setup script:

```bash
npm run setup:agentphone
```

Type-check the project:

```bash
npm run typecheck
```

Build validation currently runs TypeScript without emitting files:

```bash
npm run build
```

## License

No license file is currently included.
