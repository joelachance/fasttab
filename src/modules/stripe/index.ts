import type { Env } from "../../env.js";
import type { SplitLineItem } from "../../types.js";
import { createStripeClient, type StripeClientLike } from "./client.js";
import { createAgentCardholder, createSpendLimitedVirtualCard } from "./issuing.js";
import { createSplitPaymentLinks } from "./payment-links.js";
import type { AgentCardSpendRequest, AgentCardholderInput } from "./types.js";

export class StripeModule {
  private readonly client: StripeClientLike;

  constructor(env: Env = process.env, client?: StripeClientLike) {
    this.client = client ?? createStripeClient(env);
  }

  createPaymentLinks(splits: SplitLineItem[], roomId = "demo") {
    return createSplitPaymentLinks(this.client, splits, roomId);
  }

  createAgentCardholder(input: AgentCardholderInput) {
    return createAgentCardholder(this.client, input);
  }

  createSpendLimitedVirtualCard(input: AgentCardSpendRequest) {
    return createSpendLimitedVirtualCard(this.client, input);
  }
}

export type {
  AgentCardholder,
  AgentCardholderInput,
  AgentCardSpendRequest,
  AgentVirtualCard,
  StripePaymentLink,
} from "./types.js";
