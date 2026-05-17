import { AgentPhoneClient } from "agentphone";

export function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function createAgentPhoneClient(): AgentPhoneClient {
  return new AgentPhoneClient({
    token: getRequiredEnv("AGENTPHONE_API_KEY"),
  });
}
