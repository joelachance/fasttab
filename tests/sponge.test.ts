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
  return { issueVirtualCard };
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
});
