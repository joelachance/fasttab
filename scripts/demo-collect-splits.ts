import "../src/env.js";

import { collectSplitsFromPrompt } from "../src/foodrun/collect-splits.js";

function usage(): never {
  throw new Error(
    "Usage: bun run demo:collect -- 'Split $92.17 from Demo Thai between +1YOU +1FRIEND' --dry-run-sms",
  );
}

const args = process.argv.slice(2);
const promptParts: string[] = [];
let dryRunSms = false;
let skipCheckoutStub = false;
let roomId: string | undefined;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--dry-run-sms") {
    dryRunSms = true;
    continue;
  }
  if (arg === "--skip-checkout") {
    skipCheckoutStub = true;
    continue;
  }
  if (arg === "--room") {
    roomId = args[index + 1] ?? usage();
    index += 1;
    continue;
  }
  if (arg.startsWith("--")) {
    usage();
  }

  promptParts.push(arg);
}

const prompt = promptParts.join(" ").trim();

if (!prompt) {
  usage();
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("STRIPE_SECRET_KEY must be set to a Stripe test-mode key starting with sk_test_");
}

const result = await collectSplitsFromPrompt({
  prompt,
  roomId,
  dryRunSms,
  skipCheckoutStub,
});

console.log(JSON.stringify(result, null, 2));

if (result.texts.some((text) => !text.sent)) {
  console.error("Some texts were not sent. Copy the URLs manually or set AgentPhone env vars.");
}
