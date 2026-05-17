import { SpongeWallet } from "@paysponge/sdk";

import { envWithDefault, requiredEnv, type Env } from "../../env.js";

export type FoodOrderCardProduct = {
  name: string;
  price: number;
  quantity: number;
};

export type FoodOrderShippingAddress = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

export type IssueFoodOrderCardInput = {
  amountUsd?: string;
  merchantName: string;
  merchantUrl: string;
  description?: string;
  products?: FoodOrderCardProduct[];
  shippingAddress?: FoodOrderShippingAddress;
  enrollmentId?: string;
};

export type FoodOrderCard = {
  paymentMethodId?: string;
  cardId?: string;
  cardNumber?: string;
  cvc?: string;
  expiryMonth?: string;
  expiryYear?: string;
  expiration?: string;
  cardholderName?: string;
  billingAddress?: unknown;
  raw: unknown;
};

type IssueVirtualCardRequest = {
  amount: string;
  currency?: string;
  merchant_name: string;
  merchant_url: string;
  merchant_country_code?: string;
  description?: string;
  products?: FoodOrderCardProduct[];
  shipping_address?: {
    line1: string;
    city: string;
    state: string;
    postal_code: string;
    country_code: string;
  };
  enrollment_id?: string;
};

type SpongeWalletLike = {
  issueVirtualCard(request: IssueVirtualCardRequest): Promise<unknown>;
};

type SpongeWalletConnector = (options: {
  apiKey: string;
  baseUrl: string;
  noBrowser: true;
}) => Promise<SpongeWalletLike>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nestedRecord(record: Record<string, unknown>, ...names: string[]): Record<string, unknown> {
  for (const name of names) {
    const value = record[name];

    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }

  return {};
}

function stringField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function firstStringField(records: Record<string, unknown>[], ...names: string[]): string | undefined {
  for (const record of records) {
    const value = stringField(record, ...names);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeFoodOrderCard(raw: unknown): FoodOrderCard {
  const response = asRecord(raw);
  const card = nestedRecord(response, "card", "virtualCard", "virtual_card");
  const paymentMethod = nestedRecord(response, "paymentMethod", "payment_method");
  const records = [response, card, paymentMethod];

  return {
    paymentMethodId: firstStringField(records, "paymentMethodId", "payment_method_id"),
    cardId: firstStringField(records, "cardId", "card_id", "id"),
    cardNumber: firstStringField(records, "cardNumber", "card_number", "number", "pan"),
    cvc: firstStringField(records, "cvc", "cvv", "securityCode", "security_code"),
    expiryMonth: firstStringField(records, "expiryMonth", "expiry_month", "expMonth", "exp_month"),
    expiryYear: firstStringField(records, "expiryYear", "expiry_year", "expYear", "exp_year"),
    expiration: firstStringField(records, "expiration", "expiry", "expires", "expires_at"),
    cardholderName: firstStringField(records, "cardholderName", "cardholder_name", "name"),
    billingAddress: response.billingAddress ?? response.billing_address ?? card.billingAddress ?? card.billing_address,
    raw,
  };
}

export class SpongeModule {
  private readonly defaultAmountUsd: string;
  private readonly wallet: Promise<SpongeWalletLike>;

  constructor(
    env: Env = process.env,
    wallet?: SpongeWalletLike,
    connect: SpongeWalletConnector = SpongeWallet.connect,
  ) {
    this.defaultAmountUsd = envWithDefault(env, "SPONGE_FOOD_ORDER_CARD_AMOUNT_USD", "75");
    this.wallet =
      wallet ?
        Promise.resolve(wallet)
      : connect({
          apiKey: requiredEnv(env, "SPONGE_API_KEY"),
          baseUrl: envWithDefault(env, "SPONGE_API_BASE", "https://api.wallet.paysponge.com"),
          noBrowser: true,
        });
  }

  async issueFoodOrderCard(input: IssueFoodOrderCardInput): Promise<FoodOrderCard> {
    const wallet = await this.wallet;
    const card = await wallet.issueVirtualCard({
      amount: input.amountUsd ?? this.defaultAmountUsd,
      currency: "USD",
      merchant_name: input.merchantName,
      merchant_url: input.merchantUrl,
      merchant_country_code: "US",
      description: input.description ?? `Food order at ${input.merchantName}`,
      products: input.products,
      shipping_address:
        input.shippingAddress ?
          {
            line1: input.shippingAddress.line1,
            city: input.shippingAddress.city,
            state: input.shippingAddress.state,
            postal_code: input.shippingAddress.postalCode,
            country_code: input.shippingAddress.countryCode,
          }
        : undefined,
      enrollment_id: input.enrollmentId,
    });

    return normalizeFoodOrderCard(card);
  }
}
