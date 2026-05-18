import { existsSync, readFileSync } from "node:fs";
import { config, parse } from "dotenv";

export type Env = Record<string, string | undefined>;

/** Keys loaded from `.env.local` with file values winning over the shell. */
export const DOTENV_LOCAL_OVERRIDE_KEYS = [
  "SPONGE_API_KEY",
  "SPONGE_AGENT_ID",
  "SPONGE_AGENT_NAME",
  "SPONGE_API_BASE",
  "SPONGE_CARD_TYPE",
  "SPONGE_VIRTUAL_CARD_ID",
  "SPONGE_FOOD_ORDER_CARD_AMOUNT_USD",
  "SPONGE_DAILY_SPENDING_LIMIT_USD",
  "SPONGE_WEEKLY_SPENDING_LIMIT_USD",
  "SPONGE_MONTHLY_SPENDING_LIMIT_USD",
] as const;

export function parseDotenvLocal(): Record<string, string> {
  const path = ".env.local";

  if (!existsSync(path)) {
    return {};
  }

  const parsed = parse(readFileSync(path, "utf8"));
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/** Merge process env with `.env.local`, preferring file values for Sponge-related keys. */
export function envWithDotenvLocalOverrides(base: Env = process.env): Env {
  const local = parseDotenvLocal();
  const merged: Env = { ...base };

  for (const key of DOTENV_LOCAL_OVERRIDE_KEYS) {
    if (local[key] !== undefined) {
      merged[key] = local[key];
    }
  }

  return merged;
}

export function loadEnvFiles(): void {
  if (!process.env.VERCEL) {
    config({ path: ".env.local", quiet: true, override: true });
  }
  config({ path: ".env", quiet: true });
}

export function requiredEnv(env: Env, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function envWithDefault(env: Env, name: string, defaultValue: string): string {
  return env[name] || defaultValue;
}

loadEnvFiles();
