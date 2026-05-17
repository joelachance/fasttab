# Fasttab AgentPhone TypeScript Starter

TypeScript starter for wiring Fasttab to AgentPhone text messaging with a local webhook server and Vercel-ready serverless endpoints.

## What is here

- `src/modules/agent-mail/` sends demo confirmation emails through the AgentMail SDK.
- `src/modules/stripe/` — Payment Links per participant; Issuing cardholder + spend-limited virtual card
- `src/modules/checkout-stub/` — fake DoorDash checkout for demos
- `src/modules/split-bill/` — parse split prompts → line items
- `src/foodrun/collect-splits.ts` — end-to-end demo orchestrator
- `src/modules/sponge/` issues food-order virtual cards through the Sponge SDK.
- `src/modules/supermemory.ts` stores and retrieves food preferences by phone number through the Supermemory SDK.
- `src/modules/restaurant-availability.ts` shortlists open restaurants with Google Places/Yelp before Browser Use verifies online ordering.

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

If you already have a text-capable AgentPhone number, set `AGENTPHONE_NUMBER_ID` to that number's ID and keep `AGENTPHONE_PROVISION_NUMBER=false`.

Expose your local webhook server with a public URL, such as ngrok, or deploy the project to Vercel. Then set:

```text
AGENTPHONE_WEBHOOK_URL=https://fasttab.cc/webhook/agentphone
```

Register or reuse the AgentPhone agent and webhook:

```bash
npm run setup:agentphone
```

The setup script prints the webhook secret once. Save it as `AGENTPHONE_WEBHOOK_SECRET` in `.env.local` and in your deployment environment.

Set `AGENTPHONE_PROVISION_NUMBER=true` before running setup only if you want the script to buy a text-capable number and attach it to the agent. The default is `false` to avoid accidentally creating a billable number during local setup.

## Usage

Create Stripe test-mode payment links for a split bill:

```bash
bun run demo:collect -- 'Split $92.17 from Demo Thai between +1YOU +1FRIEND' --dry-run-sms
```

Single phone works and assigns the entire bill to one link. Use single quotes so the shell does not strip `$92.17`. Pay links with test card `4242 4242 4242 4242`.

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

- Acknowledges SMS, MMS, iMessage, and reaction events quickly.
- Ignores voice/call events because Foodrun is text-only.
- Logs delivery metadata for received events.

Vercel rewrites are configured in `vercel.json`:

```text
/health -> /api/health
/webhook/agentphone -> /api/webhook/agentphone
```

Use `/health` to verify the deployment is reachable before registering the webhook.

## Architecture

| Concern | Product | File |
|--------|---------|------|
| Collect each person's share | Stripe Payment Links | `payment-links.ts` |
| Agent pays merchant (future) | Stripe Issuing virtual card | `issuing.ts` |
| Fake DoorDash | Local stub | `checkout-stub/` |
| Parse inbound split text | Regex + Zod JSON | `split-bill/` |
| Durable order state | Neon Postgres | `migrations/`, `order-session-store.ts` |
| Demo pipeline | Orchestrator | `foodrun/collect-splits.ts` |

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
DATABASE_URL=postgresql://...
FOODRUN_CHECKOUT_MODE=dry_run
FOODRUN_JOB_SECRET=
```

Keep `AGENTPHONE_API_KEY` and `AGENTPHONE_WEBHOOK_SECRET` server-side only.

Keep `FOODRUN_CHECKOUT_MODE=dry_run` while testing. Set it to `live` only when the checkout worker is allowed to submit real restaurant orders.
Set `FOODRUN_JOB_SECRET` or Vercel `CRON_SECRET` before exposing job processing endpoints.

`AGENTPHONE_WEBHOOK_SECRET` comes from the AgentPhone webhook setup response. If you do not have it yet for Vercel, set `AGENTPHONE_WEBHOOK_URL` to the Vercel URL, run `npm run setup:agentphone`, then copy the printed secret into Vercel.

Signature verification uses the exact raw request body. Do not put JSON parsing middleware before verification if you move this handler into a framework.

In production, store and check `X-Webhook-ID` in a database or cache before doing side effects because webhook retries can duplicate deliveries.

Run database migrations after setting `DATABASE_URL`:

```bash
npm run db:migrate
```

## Development

Main files:

- `src/agentphone.ts` creates the official `agentphone` SDK client.
- `src/webhook.ts` verifies AgentPhone webhook signatures and handles supported event types.
- `src/server.ts` runs the local raw-body webhook endpoint at `/webhook/agentphone`.
- `api/webhook/agentphone.ts` exposes the same webhook handler as a Vercel serverless function.
- `api/jobs/process.ts` is the bounded Vercel worker entrypoint for queued Foodrun jobs, configured for a 5-minute max duration.
- `src/foodrun/order-session-store.ts` persists active order sessions, participants, jobs, webhook deliveries, and order events.
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
