import { describe, expect, test } from "bun:test";

import { StripeModule } from "../src/modules/stripe";
import type { StripeClientLike } from "../src/modules/stripe/client";
import type { SplitLineItem } from "../src/types";

function createFakeClient() {
  const priceCalls: Array<{ params: unknown; options: unknown }> = [];
  const paymentLinkCalls: Array<{ params: unknown; options: unknown }> = [];
  const cardholderCalls: Array<{ params: unknown; options: unknown }> = [];
  const cardCalls: Array<{ params: unknown; options: unknown }> = [];
  const client: StripeClientLike = {
    prices: {
      create: async (params, options) => {
        priceCalls.push({ params, options });
        return { id: "price_123" };
      },
    },
    paymentLinks: {
      create: async (params, options) => {
        paymentLinkCalls.push({ params, options });
        return { url: "https://buy.stripe.com/test_123" };
      },
    },
    issuing: {
      cardholders: {
        create: async (params, options) => {
          cardholderCalls.push({ params, options });
          return { id: "ich_123", status: "active" };
        },
      },
      cards: {
        create: async (params, options) => {
          cardCalls.push({ params, options });
          return { id: "ic_123", status: "active", last4: "4242" };
        },
      },
    },
  };

  return { client, priceCalls, paymentLinkCalls, cardholderCalls, cardCalls };
}

describe("StripeModule", () => {
  test("creates one payment link per split", async () => {
    const { client, priceCalls, paymentLinkCalls } = createFakeClient();
    const module = new StripeModule(
      { STRIPE_SECRET_KEY: "sk_test_123", STRIPE_API_BASE: "https://api.stripe.com/v1" },
      client,
    );
    const splits: SplitLineItem[] = [
      {
        participantId: "guest-1",
        phoneNumber: "+15551234567",
        amount: { currency: "usd", cents: 4609 },
        description: "Foodrun split",
      },
    ];

    const links = await module.createPaymentLinks(splits, "room_123");

    expect(priceCalls[0]?.params).toMatchObject({
      currency: "usd",
      unit_amount: 4609,
      product_data: { name: "Foodrun split" },
      metadata: { participantId: "guest-1", phoneNumber: "+15551234567" },
    });
    expect(priceCalls[0]?.options).toMatchObject({
      idempotencyKey: expect.stringContaining("room_123"),
    });
    expect(paymentLinkCalls[0]?.params).toMatchObject({
      line_items: [{ price: "price_123", quantity: 1 }],
      metadata: { participantId: "guest-1", phoneNumber: "+15551234567" },
    });
    expect(links).toEqual([
      {
        participantId: "guest-1",
        phoneNumber: "+15551234567",
        amountCents: 4609,
        url: "https://buy.stripe.com/test_123",
      },
    ]);
  });

  test("creates an issuing cardholder for an agent", async () => {
    const { client, cardholderCalls } = createFakeClient();
    const module = new StripeModule({ STRIPE_SECRET_KEY: "sk_test_123" }, client);

    await module.createAgentCardholder({
      agentId: "agent_123",
      name: "Foodrun Agent",
      email: "agent@example.com",
      billingAddress: {
        line1: "123 Market St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US",
      },
    });

    expect(cardholderCalls[0]?.params).toMatchObject({
      type: "individual",
      name: "Foodrun Agent",
      email: "agent@example.com",
      billing: {
        address: {
          line1: "123 Market St",
          city: "San Francisco",
          state: "CA",
          postal_code: "94105",
          country: "US",
        },
      },
      metadata: { agentId: "agent_123", useCase: "agent-restaurant-checkout" },
    });
    expect(cardholderCalls[0]?.options).toEqual({
      idempotencyKey: "foodrun:agent_123:cardholder",
    });
  });

  test("creates a spend-limited virtual card", async () => {
    const { client, cardCalls } = createFakeClient();
    const module = new StripeModule({ STRIPE_SECRET_KEY: "sk_test_123" }, client);

    await module.createSpendLimitedVirtualCard({
      roomId: "room_123",
      agentId: "agent_123",
      cardholderId: "ich_123",
      amountCents: 9217,
      merchantName: "Demo Thai",
      allowedMerchantCategories: ["eating_places_restaurants"],
    });

    expect(cardCalls[0]?.params).toMatchObject({
      cardholder: "ich_123",
      currency: "usd",
      type: "virtual",
      spending_controls: {
        allowed_categories: ["eating_places_restaurants"],
        spending_limits: [{ amount: 9217, interval: "per_authorization" }],
      },
      metadata: {
        roomId: "room_123",
        agentId: "agent_123",
        merchantName: "Demo Thai",
        useCase: "agent-restaurant-checkout",
      },
    });
    expect(cardCalls[0]?.options).toMatchObject({
      idempotencyKey: expect.stringContaining("room_123"),
    });
  });

  test("rejects zero virtual card amounts before calling Stripe", async () => {
    const { client, cardCalls } = createFakeClient();
    const module = new StripeModule({ STRIPE_SECRET_KEY: "sk_test_123" }, client);

    await expect(
      module.createSpendLimitedVirtualCard({
        roomId: "room_123",
        agentId: "agent_123",
        cardholderId: "ich_123",
        amountCents: 0,
      }),
    ).rejects.toThrow("Agent card amount must be positive");
    expect(cardCalls).toEqual([]);
  });
});
