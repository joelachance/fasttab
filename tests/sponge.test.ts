import { describe, expect, test } from "bun:test";

import { isUsableFoodOrderCard, SpongeModule } from "../src/modules/sponge";

type IssueVirtualCardRequest = {
  amount: string;
  currency?: string;
  merchant_name: string;
  merchant_url: string;
  merchant_country_code?: string;
  description?: string;
};

function fakeWallet(
  issueVirtualCard: (request: IssueVirtualCardRequest) => Promise<unknown>,
  extras: {
    getCard?: (options: Record<string, unknown>) => Promise<unknown>;
    getAgentId?: () => string;
  } = {},
) {
  return {
    getAddresses: async () => ({ base: "0x123" }),
    issueVirtualCard,
    getAgentId: extras.getAgentId ?? (() => "agent_123"),
    getCard: extras.getCard,
  };
}

describe("SpongeModule", () => {
  test("isUsableFoodOrderCard requires full pan, cvc, and expiry", () => {
    expect(
      isUsableFoodOrderCard({
        cardNumber: "4111111111111111",
        cvc: "123",
        expiration: "12/29",
        raw: {},
      }),
    ).toBe(true);
    expect(
      isUsableFoodOrderCard({
        cardNumber: "1111",
        cvc: "123",
        expiration: "12/29",
        raw: {},
      }),
    ).toBe(false);
  });

  test("issues a virtual card scoped to a food ordering merchant", async () => {
    const calls: IssueVirtualCardRequest[] = [];
    const module = new SpongeModule(
      { SPONGE_API_KEY: "unused" },
      fakeWallet(async (request) => {
        calls.push(request);
        return {
          payment_method_id: "pm_123",
          card: {
            id: "card_123",
            number: "4111111111111111",
            cvc: "123",
            expiry_month: "12",
            expiry_year: "2030",
            cardholder_name: "Foodrun Agent",
          },
        };
      }),
    );

    const card = await module.issueFoodOrderCard({
      amountUsd: "42.50",
      merchantName: "Demo Thai",
      merchantUrl: "https://demo-thai.example.com",
    });

    expect(calls[0]).toMatchObject({
      amount: "42.50",
      currency: "USD",
      merchant_name: "Demo Thai",
      merchant_url: "https://demo-thai.example.com",
      merchant_country_code: "US",
      description: "Food order at Demo Thai",
    });
    expect(card).toMatchObject({
      paymentMethodId: "pm_123",
      cardId: "card_123",
      cardNumber: "4111111111111111",
      cvc: "123",
      expiryMonth: "12",
      expiryYear: "2030",
      cardholderName: "Foodrun Agent",
    });
  });

  test("uses SPONGE_FOOD_ORDER_CARD_AMOUNT_USD when amount is omitted", async () => {
    const amounts: string[] = [];
    const module = new SpongeModule(
      {
        SPONGE_API_KEY: "unused",
        SPONGE_FOOD_ORDER_CARD_AMOUNT_USD: "88.00",
      },
      fakeWallet(async (request) => {
        amounts.push(request.amount);
        return { cardId: "card_456" };
      }),
    );

    await module.issueFoodOrderCard({
      merchantName: "Demo Pizza",
      merchantUrl: "https://demo-pizza.example.com",
    });

    expect(amounts).toEqual(["88.00"]);
  });

  test("connects with env credentials when no wallet is injected", async () => {
    const connectCalls: unknown[] = [];
    const module = new SpongeModule(
      {
        SPONGE_API_KEY: "sp_test_123",
        SPONGE_API_BASE: "https://api.test.paysponge.com",
      },
      undefined,
      async (options) => {
        connectCalls.push(options);
        return fakeWallet(async () => ({ card_number: "4242424242424242" }));
      },
    );

    await module.issueFoodOrderCard({
      amountUsd: "25",
      merchantName: "Demo Burgers",
      merchantUrl: "https://demo-burgers.example.com",
    });

    expect(connectCalls).toEqual([
      {
        apiKey: "sp_test_123",
        baseUrl: "https://api.test.paysponge.com",
        noBrowser: true,
      },
    ]);
  });

  test("connects directly when agent key is set even if SPONGE_AGENT_ID is present", async () => {
    const connectCalls: unknown[] = [];
    const module = new SpongeModule(
      {
        SPONGE_API_KEY: "sponge_live_123",
        SPONGE_API_BASE: "https://api.test.paysponge.com",
        SPONGE_AGENT_ID: "8338cfc8-49e6-46f1-a7d4-218b1a17e31b",
        SPONGE_AGENT_NAME: "Fasttab Foodrun Agent",
      },
      undefined,
      async (options) => {
        connectCalls.push(options);
        return fakeWallet(async () => ({ cardId: "card_direct" }));
      },
      async () => {
        throw new Error("SpongePlatform.connect should not be called for agent keys");
      },
    );

    await module.issueFoodOrderCard({
      amountUsd: "10",
      merchantName: "Demo Burgers",
      merchantUrl: "https://demo-burgers.example.com",
    });

    expect(connectCalls).toEqual([
      {
        apiKey: "sponge_live_123",
        baseUrl: "https://api.test.paysponge.com",
        noBrowser: true,
      },
    ]);
  });

  test("fetches the most recent virtual card for an agent", async () => {
    const module = new SpongeModule(
      {
        SPONGE_API_KEY: "sponge_live_agent_123",
        SPONGE_AGENT_ID: "agent_123",
        SPONGE_API_BASE: "https://api.test.paysponge.com",
      },
      fakeWallet(
        async () => {
          throw new Error("issueVirtualCard should not be called");
        },
        {
          async getCard(options) {
            expect(options).toMatchObject({ payment_method_id: "pm_newer" });
            return {
              payment_method_id: "pm_newer",
              card: {
                id: "card_newer",
                number: "4111111111111111",
                cvc: "123",
                expiry_month: "11",
                expiry_year: "2031",
                status: "active",
                amount: "42.00",
              },
            };
          },
        },
      ),
      async () => {
        throw new Error("SpongeWallet.connect should not be called when agent id is set");
      },
      async () => ({
        async listAgents() {
          return [{ id: "agent_123", name: "Fasttab Test Agent" }];
        },
        async getAgentApiKey() {
          return "sponge_live_agent_123";
        },
        async connectAgent() {
          throw new Error("connectAgent should not be called when wallet is injected");
        },
        async createAgent() {
          throw new Error("createAgent should not be called");
        },
      }),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes("/payment-methods")) {
        return new Response(
          JSON.stringify({
            payment_methods: [
              {
                payment_method_id: "pm_older",
                card_id: "card_older",
                created_at: "2026-01-01T00:00:00.000Z",
                status: "closed",
              },
              {
                payment_method_id: "pm_newer",
                card_id: "card_newer",
                created_at: "2026-05-01T00:00:00.000Z",
                status: "active",
                amount: "42.00",
                merchant_name: "Demo Thai",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return originalFetch(input);
    };

    try {
      const card = await module.fetchFoodOrderCard();

      expect(card).toMatchObject({
        paymentMethodId: "pm_newer",
        cardId: "card_newer",
        cardNumber: "4111111111111111",
        expiryMonth: "11",
        expiryYear: "2031",
        status: "active",
        amountUsd: "42.00",
        merchantName: "Demo Thai",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to Sponge Card rain credentials when payment methods are unavailable", async () => {
    const module = new SpongeModule(
      { SPONGE_API_KEY: "sponge_live_agent_123" },
      fakeWallet(
        async () => {
          throw new Error("issueVirtualCard should not be called");
        },
        {
          getAgentId: () => "agent_123",
          async getCard(options) {
            if (options.card_type === "rain") {
              return {
                status: "ok",
                card_type: "rain",
                expiration_month: "12",
                expiration_year: "2032",
                card_number: "4111111111111111",
                cvc: "123",
              };
            }

            throw new Error("payment method fetch should not run");
          },
        },
      ),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes("/payment-methods")) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      }

      return originalFetch(input);
    };

    try {
      const card = await module.fetchFoodOrderCard();

      expect(card).toMatchObject({
        cardNumber: "4111111111111111",
        cvc: "123",
        expiryMonth: "12",
        expiryYear: "2032",
        status: "ok",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchCheckoutCard reuses an existing session card without fetching", async () => {
    const module = new SpongeModule(
      { SPONGE_API_KEY: "sponge_live_agent_123" },
      fakeWallet(
        async () => {
          throw new Error("issueVirtualCard should not be called");
        },
        {
          async getCard() {
            throw new Error("getCard should not be called when session card is complete");
          },
        },
      ),
    );

    const card = await module.fetchCheckoutCard(
      { SPONGE_API_KEY: "sponge_live_agent_123" },
      {
        existingCard: {
          cardNumber: "4111111111111111",
          cvc: "123",
          expiryMonth: "12",
          expiryYear: "2030",
          raw: {},
        },
      },
    );

    expect(card.cardNumber).toBe("4111111111111111");
  });

  test("fetches a virtual card by explicit payment method id", async () => {
    const module = new SpongeModule(
      { SPONGE_API_KEY: "sponge_live_agent_123" },
      fakeWallet(
        async () => {
          throw new Error("issueVirtualCard should not be called");
        },
        {
          async getCard(options) {
            expect(options).toMatchObject({ payment_method_id: "pm_explicit" });
            return {
              payment_method_id: "pm_explicit",
              card: {
                id: "card_explicit",
                number: "4242424242424242",
                cvc: "123",
                expiration: "12/30",
                status: "active",
              },
            };
          },
        },
      ),
    );

    const card = await module.fetchFoodOrderCard({ paymentMethodId: "pm_explicit" });

    expect(card).toMatchObject({
      paymentMethodId: "pm_explicit",
      cardId: "card_explicit",
      status: "active",
    });
  });

  test("uses SpongePlatform when SPONGE_API_KEY is a master key", async () => {
    const platformCalls: unknown[] = [];
    const connectAgentCalls: unknown[] = [];
    const module = new SpongeModule(
      {
        SPONGE_API_KEY: "sponge_master_123",
        SPONGE_API_BASE: "https://api.test.paysponge.com",
        SPONGE_AGENT_NAME: "Fasttab Test Agent",
      },
      undefined,
      async () => {
        throw new Error("SpongeWallet.connect should not be called for master keys");
      },
      async (options) => {
        platformCalls.push(options);
        return {
          async listAgents() {
            return [{ id: "agent_123", name: "Fasttab Test Agent" }];
          },
          async createAgent(request) {
            platformCalls.push(request);
            return { agent: { id: "agent_123" }, apiKey: "sponge_test_agent_123" };
          },
          async getAgentApiKey(agentId: string) {
            return agentId === "agent_123" ? "sponge_test_agent_123" : null;
          },
          async connectAgent(request) {
            connectAgentCalls.push(request);
            return fakeWallet(async () => ({ cardId: "card_789" }));
          },
        };
      },
    );

    expect(await module.getAddresses()).toEqual({ base: "0x123" });
    expect(platformCalls[0]).toEqual({
      apiKey: "sponge_master_123",
      baseUrl: "https://api.test.paysponge.com",
    });
    expect(connectAgentCalls).toEqual([
      { apiKey: "sponge_test_agent_123", agentId: "agent_123" },
    ]);
  });
});
