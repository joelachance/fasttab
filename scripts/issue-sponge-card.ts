/**
 * Issues a new per-transaction Sponge virtual card.
 * Prefer `bun run sponge:fetch-card` when reusing an already-issued card.
 */
import { SpongePlatform } from "@paysponge/sdk";

import { envWithDefault, envWithDotenvLocalOverrides, requiredEnv } from "../src/env.js";
import {
  formatExpiry,
  lastFour,
  maskPan,
  SpongeModule,
} from "../src/modules/sponge/index.js";

const MERCHANT_NAME = "Insomnia Cookies";
const MERCHANT_URL = "https://insomniacookies.com/";

const SPONGE_AGENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSpongeAgentId(env: NodeJS.ProcessEnv): Promise<void> {
  const apiKey = requiredEnv(env, "SPONGE_API_KEY");

  if (!apiKey.startsWith("sponge_master")) {
    return;
  }

  const raw = env.SPONGE_AGENT_ID?.trim();

  if (raw && SPONGE_AGENT_UUID_RE.test(raw)) {
    return;
  }

  const agentName = raw || envWithDefault(env, "SPONGE_AGENT_NAME", "Fasttab Foodrun Agent");
  const baseUrl = envWithDefault(env, "SPONGE_API_BASE", "https://api.wallet.paysponge.com");
  const platform = await SpongePlatform.connect({ apiKey, baseUrl });
  const agents = await platform.listAgents();
  const match = agents.find((agent) => agent.name === agentName || agent.id === agentName);

  if (!match) {
    throw new Error(
      `No Sponge agent named "${agentName}". Set SPONGE_AGENT_ID in .env.local or create the agent in the Sponge dashboard.`,
    );
  }

  env.SPONGE_AGENT_ID = match.id;
  console.error(`Using existing Sponge agent "${match.name}" (${match.id}).`);
}

function maskApiKeyPrefix(apiKey: string): string {
  const trimmed = apiKey.trim();

  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 8)}...`;
  }

  return `${trimmed.slice(0, 16)}...`;
}

try {
  const env = envWithDotenvLocalOverrides();
  const apiKey = env.SPONGE_API_KEY?.trim();

  if (!apiKey) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
    process.exit(1);
  }

  console.error(`Using SPONGE_API_KEY ${maskApiKeyPrefix(apiKey)} from .env.local`);
  requiredEnv(env, "SPONGE_API_KEY");
  await resolveSpongeAgentId(env);

  const amountUsd = envWithDefault(env, "SPONGE_FOOD_ORDER_CARD_AMOUNT_USD", "105");
  const sponge = new SpongeModule(env);

  console.error(`Issuing Sponge test card for ${MERCHANT_NAME} ($${amountUsd} USD)...`);

  const card = await sponge.issueFoodOrderCard({
    amountUsd,
    merchantName: MERCHANT_NAME,
    merchantUrl: MERCHANT_URL,
    description: `FastTab script test — ${MERCHANT_NAME}`,
  });

  if (!card.cardNumber && !card.cardId && !card.paymentMethodId) {
    console.error("Sponge API responded but no card identifiers were returned.");
    console.error(JSON.stringify(card.raw, null, 2));
    process.exit(1);
  }

  const output = {
    ok: true,
    merchant: MERCHANT_NAME,
    merchantUrl: MERCHANT_URL,
    amountUsd,
    last4: lastFour(card.cardNumber),
    expiry: formatExpiry(card),
    cardId: card.cardId,
    paymentMethodId: card.paymentMethodId,
    panMasked: maskPan(card.cardNumber),
    cardholderName: card.cardholderName,
  };

  console.log(JSON.stringify(output, null, 2));
  console.error("Card issued successfully.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Missing required environment variable: SPONGE_API_KEY")) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
  } else if (message.includes("already exists for this account")) {
    console.error(message);
    console.error("Set SPONGE_AGENT_ID in .env.local to your existing test agent (Sponge dashboard).");
  } else if (message.includes("admin-only")) {
    console.error(`Sponge API rejected card issuance: ${message}`);
    console.error("Agentic commerce may need to be enabled on your Sponge account (contact Paysponge support).");
  } else if (message.includes("fetch") || message.includes("401") || message.includes("403")) {
    console.error(`Sponge API request failed: ${message}`);
    console.error("Check SPONGE_API_KEY and SPONGE_API_BASE in .env.local.");
  } else {
    console.error(`Failed to issue Sponge card: ${message}`);
  }

  process.exit(1);
}
