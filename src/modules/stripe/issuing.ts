import type { StripeClientLike } from "./client.js";
import type {
  AgentCardSpendRequest,
  AgentCardholder,
  AgentCardholderInput,
  AgentVirtualCard,
} from "./types.js";

function sanitizeIdempotencyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 255);
}

export function agentCardIdempotencyKey(input: AgentCardSpendRequest): string {
  return sanitizeIdempotencyKey(
    [
      "foodrun",
      input.roomId,
      input.agentId,
      input.cardholderId,
      input.currency ?? "usd",
      input.amountCents,
      input.merchantName ?? "",
    ].join(":"),
  );
}

export async function createAgentCardholder(
  client: StripeClientLike,
  input: AgentCardholderInput,
): Promise<AgentCardholder> {
  if (!client.issuing) {
    throw new Error("Stripe Issuing is not available on this client");
  }

  return client.issuing.cardholders.create(
    {
      type: "individual",
      name: input.name,
      email: input.email,
      billing: {
        address: {
          line1: input.billingAddress.line1,
          city: input.billingAddress.city,
          state: input.billingAddress.state,
          postal_code: input.billingAddress.postalCode,
          country: input.billingAddress.country,
        },
      },
      metadata: {
        agentId: input.agentId,
        useCase: "agent-restaurant-checkout",
      },
    },
    { idempotencyKey: `foodrun:${input.agentId}:cardholder` },
  );
}

export async function createSpendLimitedVirtualCard(
  client: StripeClientLike,
  input: AgentCardSpendRequest,
): Promise<AgentVirtualCard> {
  if (!client.issuing) {
    throw new Error("Stripe Issuing is not available on this client");
  }
  if (input.amountCents <= 0) {
    throw new Error("Agent card amount must be positive");
  }

  return client.issuing.cards.create(
    {
      cardholder: input.cardholderId,
      currency: input.currency ?? "usd",
      type: "virtual",
      spending_controls: {
        allowed_categories: input.allowedMerchantCategories,
        spending_limits: [{ amount: input.amountCents, interval: "per_authorization" }],
      },
      metadata: {
        roomId: input.roomId,
        agentId: input.agentId,
        merchantName: input.merchantName ?? "",
        useCase: "agent-restaurant-checkout",
      },
    },
    { idempotencyKey: agentCardIdempotencyKey(input) },
  );
}
