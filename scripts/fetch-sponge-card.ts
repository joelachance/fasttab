import { SpongePlatform } from "@paysponge/sdk";

import { envWithDefault, envWithDotenvLocalOverrides, requiredEnv } from "../src/env.js";
import {
  formatExpiry,
  lastFour,
  maskPan,
  SpongeModule,
  type FoodOrderCard,
} from "../src/modules/sponge/index.js";

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
  console.error(`Using Sponge agent "${match.name}" (${match.id}).`);
}

function maskApiKeyPrefix(apiKey: string): string {
  const trimmed = apiKey.trim();

  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 8)}...`;
  }

  return `${trimmed.slice(0, 16)}...`;
}

function safeCardOutput(card: FoodOrderCard) {
  const panSource = card.cardNumber && card.cardNumber.replace(/\D/g, "").length > 4 ? card.cardNumber : undefined;

  return {
    ok: true,
    cardId: card.cardId,
    paymentMethodId: card.paymentMethodId,
    panMasked: maskPan(panSource) ?? (card.cardNumber && card.cardNumber.length <= 8 ? card.cardNumber : undefined),
    last4: lastFour(panSource) ?? (card.cardNumber?.length === 4 ? card.cardNumber : undefined),
    expiry: formatExpiry(card),
    status: card.status,
    amountUsd: card.amountUsd,
    limitUsd: card.limitUsd,
    merchantName: card.merchantName,
    merchantUrl: card.merchantUrl,
    cardholderName: card.cardholderName,
  };
}

try {
  const env = envWithDotenvLocalOverrides();
  const apiKey = env.SPONGE_API_KEY?.trim();

  if (!apiKey) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
    process.exit(1);
  }

  console.error(`Using SPONGE_API_KEY ${maskApiKeyPrefix(apiKey)} from .env.local`);
  await resolveSpongeAgentId(env);

  const sponge = new SpongeModule(env);
  const cardId =
    env.SPONGE_VIRTUAL_CARD_ID?.trim() ||
    env.SPONGE_CARD_ID?.trim() ||
    env.CARD_ID?.trim();
  const paymentMethodId =
    env.SPONGE_VIRTUAL_CARD_ID?.trim() || env.SPONGE_PAYMENT_METHOD_ID?.trim();

  if (cardId || paymentMethodId) {
    console.error("Fetching Sponge card by id...");
  } else {
    console.error("Fetching active Sponge card for this agent...");
  }

  const card = await sponge.fetchFoodOrderCard({ cardId, paymentMethodId });

  if (!card.cardId && !card.paymentMethodId && !card.cardNumber) {
    console.error("Sponge API responded but no card identifiers were returned.");
    console.error(JSON.stringify(card.raw, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(safeCardOutput(card), null, 2));
  console.error("Card fetched successfully.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Missing required environment variable: SPONGE_API_KEY")) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
  } else if (message.includes("No active Sponge card")) {
    console.error(message);
    console.error("Enroll Sponge Card on this agent or set SPONGE_VIRTUAL_CARD_ID in .env.local.");
  } else if (message.includes("fetch") || message.includes("401") || message.includes("403")) {
    console.error(`Sponge API request failed: ${message}`);
    console.error("Check SPONGE_API_KEY and SPONGE_API_BASE in .env.local.");
  } else {
    console.error(`Failed to fetch Sponge card: ${message}`);
  }

  process.exit(1);
}
