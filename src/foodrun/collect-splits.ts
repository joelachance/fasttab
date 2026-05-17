import { AgentPhoneClient } from "agentphone";

import { envWithDefault, requiredEnv, type Env } from "../env.js";
import {
  stubDoorDashCheckout,
  type StubDoorDashCheckoutResult,
} from "../modules/checkout-stub/index.js";
import {
  buildSplitLineItems,
  parseSplitPrompt,
  type ParsedSplitPrompt,
} from "../modules/split-bill/index.js";
import { StripeModule, type StripePaymentLink } from "../modules/stripe/index.js";
import type { SplitLineItem } from "../types.js";

export type CollectSplitsInput = {
  prompt: string;
  roomId?: string;
  skipCheckoutStub?: boolean;
  dryRunSms?: boolean;
};

export type CollectSplitsResult = {
  roomId: string;
  checkout: StubDoorDashCheckoutResult | null;
  splits: SplitLineItem[];
  paymentLinks: StripePaymentLink[];
  texts: Array<{ phoneNumber: string; body: string; sent: boolean }>;
};

class AgentPhoneModule {
  private readonly client: AgentPhoneClient;

  constructor(private readonly env: Env = process.env) {
    this.client = new AgentPhoneClient({
      token: requiredEnv(env, "AGENTPHONE_API_KEY"),
      baseUrl: envWithDefault(env, "AGENTPHONE_API_BASE", "https://api.agentphone.ai/v1"),
    });
  }

  async sendText(input: { agentId: string; toNumber: string; body: string }): Promise<void> {
    await this.client.messages.sendMessage({
      agent_id: input.agentId,
      to_number: input.toNumber,
      body: input.body,
    });
  }
}

function normalizePhone(phoneNumber?: string): string | undefined {
  return phoneNumber?.replace(/[^\d+]/g, "");
}

function agentPhoneNumber(env: Env): string | undefined {
  return normalizePhone(env.AGENTPHONE_PHONE_NUMBER ?? env.AGENTPHONE_NUMBER);
}

function excludeAgentPhone(parsed: ParsedSplitPrompt, env: Env): ParsedSplitPrompt {
  const excluded = agentPhoneNumber(env);

  if (!excluded) {
    return parsed;
  }

  return {
    ...parsed,
    participants: parsed.participants.filter(
      (participant) => normalizePhone(participant.phoneNumber) !== excluded,
    ),
  };
}

export function formatPaymentLinkSms(
  link: StripePaymentLink,
  restaurantName?: string,
): string {
  const restaurant = restaurantName ? ` for ${restaurantName}` : "";

  return `Foodrun demo${restaurant}: your share is $${(link.amountCents / 100).toFixed(2)}.\nPay with a Stripe test card: ${link.url}`;
}

export function tryCreateAgentPhone(): AgentPhoneModule | null {
  try {
    return new AgentPhoneModule();
  } catch {
    return null;
  }
}

export async function collectSplitsFromPrompt(
  input: CollectSplitsInput,
): Promise<CollectSplitsResult> {
  const parsed = parseSplitPrompt(input.prompt);
  const roomId = input.roomId ?? parsed.roomId ?? "demo";
  const checkout =
    input.skipCheckoutStub ?
      null
    : stubDoorDashCheckout({
        restaurantName: parsed.restaurantName,
        totalCents: parsed.totalCents,
      });
  const billableParsed = excludeAgentPhone(parsed, process.env);
  const splits = buildSplitLineItems(
    { ...billableParsed, totalCents: billableParsed.totalCents ?? checkout?.total.cents },
    {
      roomId,
      defaultDescription: checkout ? `Foodrun split — ${checkout.restaurantName}` : undefined,
    },
  );
  const paymentLinks = await new StripeModule().createPaymentLinks(splits, roomId);
  const phone = input.dryRunSms ? null : tryCreateAgentPhone();
  const texts: CollectSplitsResult["texts"] = [];

  for (const link of paymentLinks) {
    const body = formatPaymentLinkSms(link, parsed.restaurantName);
    let sent = false;

    if (phone) {
      const agentId = process.env.AGENTPHONE_AGENT_ID;

      if (!agentId) {
        throw new Error("Missing AGENTPHONE_AGENT_ID");
      }

      await phone.sendText({ agentId, toNumber: link.phoneNumber, body });
      sent = true;
    }

    texts.push({ phoneNumber: link.phoneNumber, body, sent });
  }

  return { roomId, checkout, splits, paymentLinks, texts };
}
