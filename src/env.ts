import { config } from "dotenv";

export type Env = Record<string, string | undefined>;

export function loadEnvFiles(): void {
  config({ path: ".env.local", quiet: true });
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
