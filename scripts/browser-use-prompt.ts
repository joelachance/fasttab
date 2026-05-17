import "../src/env.js";

import type { MessageResponse } from "browser-use-sdk/v3";

import { BrowserPromptOutputSchema, BrowserUseModule } from "../src/modules/browser-use/index.js";

const args = process.argv.slice(2);
const prompt = firstNonFlagArg(args);
const dryRun = args.includes("--dry-run");
const timeoutSeconds = numberFlag(args, "--timeout", 240);
const maxCostUsd = numberFlag(args, "--max-cost", 1);

if (!prompt) {
  console.error('Usage: bun run browser:prompt -- "<prompt>" [--dry-run] [--timeout 240] [--max-cost 1]');
  process.exit(1);
}

if (dryRun) {
  console.log(prompt);
  process.exit(0);
}

try {
  const browserUse = new BrowserUseModule();
  const result = await browserUse.runTask(prompt, BrowserPromptOutputSchema, {
    timeoutMs: timeoutSeconds * 1000,
    maxCostUsd,
    onMessage(message: MessageResponse) {
      if (!message.hidden && message.summary) {
        console.error(message.summary);
      }
    },
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const sessionMatch = message.match(/Session ([0-9a-f-]+) did not complete/i);

  console.error(message);

  if (sessionMatch?.[1]) {
    console.error(`Hint: run bun run browser:session -- ${sessionMatch[1]}`);
  }

  process.exit(1);
}

function firstNonFlagArg(args: string[]): string | undefined {
  return args.find((arg, index) => {
    if (arg.startsWith("--")) {
      return false;
    }

    return index === 0 || !args[index - 1]?.startsWith("--");
  });
}

function numberFlag(args: string[], name: string, defaultValue: number): number {
  const index = args.indexOf(name);

  if (index === -1) {
    return defaultValue;
  }

  const value = Number(args[index + 1]);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name} value`);
  }

  return value;
}
