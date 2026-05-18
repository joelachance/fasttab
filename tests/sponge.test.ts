import { describe, expect, test } from "bun:test";

import { SpongeModule } from "../src/modules/sponge";

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
) {
  return { getAddresses: async () => ({ base: "0x123" }), issueVirtualCard };
}

describe("SpongeModule", () => {
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
