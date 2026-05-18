import { SpongePlatform } from "@paysponge/sdk";

import { envWithDefault, requiredEnv } from "../src/env.js";
import { SpongeModule } from "../src/modules/sponge/index.js";

const MERCHANT_NAME = "Insomnia Cookies";
const MERCHANT_URL = "https://insomniacookies.com/";

function maskPan(pan: string | undefined): string | undefined {
  if (!pan) {
    return undefined;
  }

  const digits = pan.replace(/\D/g, "");

  if (digits.length < 4) {
    return "****";
  }

  return `****${digits.slice(-4)}`;
}

function formatExpiry(card: {
  expiryMonth?: string;
  expiryYear?: string;
  expiration?: string;
}): string | undefined {
  if (card.expiration) {
    return card.expiration;
  }

  if (card.expiryMonth && card.expiryYear) {
    const year = card.expiryYear.length === 4 ? card.expiryYear.slice(-2) : card.expiryYear;
    return `${card.expiryMonth.padStart(2, "0")}/${year}`;
  }

  return undefined;
}

function lastFour(pan: string | undefined): string | undefined {
  if (!pan) {
    return undefined;
  }

  const digits = pan.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

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

try {
  const env = process.env;
  const apiKey = env.SPONGE_API_KEY?.trim();

  if (!apiKey) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
    process.exit(1);
  }

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
