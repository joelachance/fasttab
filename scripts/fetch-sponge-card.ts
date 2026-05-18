import { SpongePlatform } from "@paysponge/sdk";

import { envWithDefault, requiredEnv } from "../src/env.js";
import { SpongeModule } from "../src/modules/sponge/index.js";

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

  await resolveSpongeAgentId(env);

  const sponge = new SpongeModule(env);
  const addresses = await sponge.getAddresses();

  console.log(JSON.stringify({ ok: true, addresses }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Missing required environment variable: SPONGE_API_KEY")) {
    console.error("Missing SPONGE_API_KEY. Set it in .env.local (see .env.example).");
  } else if (message.includes("fetch") || message.includes("401") || message.includes("403")) {
    console.error(`Sponge API request failed: ${message}`);
    console.error("Check SPONGE_API_KEY and SPONGE_API_BASE in .env.local.");
  } else {
    console.error(`Failed to fetch Sponge wallet: ${message}`);
  }

  process.exit(1);
}
