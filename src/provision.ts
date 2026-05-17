import { createAgentPhoneClient, getRequiredEnv } from "./agentphone.js";

const client = createAgentPhoneClient();

async function main(): Promise<void> {
  const agentId = process.env.AGENTPHONE_AGENT_ID;
  const webhookUrl = getRequiredEnv("AGENTPHONE_WEBHOOK_URL");

  const agent =
    agentId ?
      await client.agents.getAgent({ agent_id: agentId })
    : await client.agents.createAgent({
        name: process.env.AGENTPHONE_AGENT_NAME ?? "Fasttab Agent",
      });

  const webhook = await client.webhooks.createOrUpdateWebhook({
    url: webhookUrl,
    contextLimit: 10,
  });
  const existingNumberId = process.env.AGENTPHONE_NUMBER_ID;
  const number =
    existingNumberId ? { id: existingNumberId }
    : process.env.AGENTPHONE_PROVISION_NUMBER === "true" ?
      await client.numbers.createNumber()
    : null;

  if (number) {
    await client.agents.attachNumberToAgent({
      agent_id: agent.id,
      numberId: number.id,
    });
  }

  console.log("AgentPhone agent ready", {
    agentId: agent.id,
    numberId: number?.id,
    webhookUrl,
  });
  console.log("Save this webhook secret in AGENTPHONE_WEBHOOK_SECRET:", webhook.secret);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
