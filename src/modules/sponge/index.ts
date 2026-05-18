import { createDecipheriv } from "node:crypto";

import { HttpClient, SpongePlatform, SpongeWallet } from "@paysponge/sdk";

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
  status?: string;
  amountUsd?: string;
  limitUsd?: string;
  merchantName?: string;
  merchantUrl?: string;
  billingAddress?: unknown;
  raw: unknown;
};

export type PaymentMethodSummary = {
  paymentMethodId: string;
  cardId?: string;
  status?: string;
  amountUsd?: string;
  limitUsd?: string;
  merchantName?: string;
  merchantUrl?: string;
  last4?: string;
  expiryMonth?: string;
  expiryYear?: string;
  createdAt?: string;
  raw: unknown;
};

export type FetchFoodOrderCardInput = {
  cardId?: string;
  paymentMethodId?: string;
};

type FetchRainSpongeCardInput = {
  amountUsd?: string;
  merchantName?: string;
  merchantUrl?: string;
  cardType?: "rain" | "basis_theory_vaulted";
  paymentMethodId?: string;
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

type GetCardOptions = {
  card_type?: "rain" | "basis_theory_vaulted";
  payment_method_id?: string;
  paymentMethodId?: string;
  amount?: string;
  currency?: string;
  merchant_name?: string;
  merchant_url?: string;
};

type SpongeWalletLike = {
  getAddresses?(): Promise<Record<string, string>>;
  issueVirtualCard(request: IssueVirtualCardRequest): Promise<unknown>;
  getCard?(options?: GetCardOptions): Promise<unknown>;
  getAgentId?(): string;
};

type SpongeConnection = {
  wallet: SpongeWalletLike;
  agentId: string;
  apiKey: string;
  baseUrl: string;
};

type SpongeWalletConnector = (options: {
  apiKey: string;
  baseUrl: string;
  noBrowser: true;
}) => Promise<SpongeWalletLike>;

type SpongePlatformLike = {
  createAgent(options: {
    name: string;
    description?: string;
    dailySpendingLimit?: string;
    weeklySpendingLimit?: string;
    monthlySpendingLimit?: string;
    isTestMode?: boolean;
  }): Promise<{ agent: { id: string }; apiKey: string }>;
  getAgentApiKey(agentId: string, isTestMode?: boolean): Promise<string | null>;
  connectAgent(options: { apiKey: string; agentId?: string }): Promise<SpongeWalletLike>;
};

type SpongePlatformConnector = (options: {
  apiKey: string;
  baseUrl: string;
}) => Promise<SpongePlatformLike>;

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

type EncryptedSpongeField = {
  iv: string;
  data: string;
};

function nestedEncryptedField(
  record: Record<string, unknown>,
  ...names: string[]
): EncryptedSpongeField | undefined {
  for (const name of names) {
    const value = record[name];

    if (value && typeof value === "object") {
      const field = value as Record<string, unknown>;

      if (typeof field.iv === "string" && typeof field.data === "string") {
        return { iv: field.iv, data: field.data };
      }
    }
  }

  return undefined;
}

function decryptSpongeCardField(
  encrypted: EncryptedSpongeField | undefined,
  secretKeyHex: string | undefined,
): string | undefined {
  if (!encrypted?.iv || !encrypted?.data || !secretKeyHex) {
    return undefined;
  }

  try {
    const ciphertext = Buffer.from(encrypted.data, "base64");
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const payload = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = createDecipheriv(
      "aes-128-gcm",
      Buffer.from(secretKeyHex, "hex"),
      Buffer.from(encrypted.iv, "base64"),
    );

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

function normalizeFoodOrderCard(raw: unknown, metadata?: PaymentMethodSummary): FoodOrderCard {
  const response = asRecord(raw);
  const card = nestedRecord(response, "card", "virtualCard", "virtual_card");
  const paymentMethod = nestedRecord(response, "paymentMethod", "payment_method");
  const records = [response, card, paymentMethod];

  return {
    paymentMethodId:
      metadata?.paymentMethodId ??
      firstStringField(records, "paymentMethodId", "payment_method_id"),
    cardId: metadata?.cardId ?? firstStringField(records, "cardId", "card_id", "id"),
    cardNumber: firstStringField(records, "cardNumber", "card_number", "number", "pan"),
    cvc: firstStringField(records, "cvc", "cvv", "securityCode", "security_code"),
    expiryMonth:
      metadata?.expiryMonth ??
      firstStringField(records, "expiryMonth", "expiry_month", "expMonth", "exp_month", "expiration_month"),
    expiryYear:
      metadata?.expiryYear ??
      firstStringField(records, "expiryYear", "expiry_year", "expYear", "exp_year", "expiration_year"),
    expiration: firstStringField(records, "expiration", "expiry", "expires", "expires_at"),
    cardholderName: firstStringField(records, "cardholderName", "cardholder_name", "name"),
    status: metadata?.status ?? firstStringField(records, "status", "card_status", "state"),
    amountUsd:
      metadata?.amountUsd ??
      firstStringField(records, "amount", "amount_usd", "amountUsd", "spending_limit", "spendingLimit"),
    limitUsd: metadata?.limitUsd ?? firstStringField(records, "limit", "limit_usd", "limitUsd", "spending_limit"),
    merchantName: metadata?.merchantName ?? firstStringField(records, "merchant_name", "merchantName"),
    merchantUrl: metadata?.merchantUrl ?? firstStringField(records, "merchant_url", "merchantUrl"),
    billingAddress: response.billingAddress ?? response.billing_address ?? card.billingAddress ?? card.billing_address,
    raw,
  };
}

function paymentMethodRecords(raw: unknown): Record<string, unknown>[] {
  const response = asRecord(raw);

  if (Array.isArray(raw)) {
    return raw.map((entry) => asRecord(entry));
  }

  for (const key of ["paymentMethods", "payment_methods", "methods", "items", "data"]) {
    const value = response[key];

    if (Array.isArray(value)) {
      return value.map((entry) => asRecord(entry));
    }
  }

  return [];
}

function normalizePaymentMethodSummary(raw: unknown): PaymentMethodSummary | undefined {
  const record = asRecord(raw);
  const paymentMethodId = firstStringField(
    [record],
    "paymentMethodId",
    "payment_method_id",
    "id",
    "methodId",
    "method_id",
  );

  if (!paymentMethodId) {
    return undefined;
  }

  return {
    paymentMethodId,
    cardId: firstStringField([record], "cardId", "card_id", "virtualCardId", "virtual_card_id"),
    status: firstStringField([record], "status", "card_status", "state"),
    amountUsd: firstStringField([record], "amount", "amount_usd", "amountUsd"),
    limitUsd: firstStringField([record], "limit", "limit_usd", "limitUsd", "spending_limit", "spendingLimit"),
    merchantName: firstStringField([record], "merchant_name", "merchantName"),
    merchantUrl: firstStringField([record], "merchant_url", "merchantUrl"),
    last4: firstStringField([record], "last4", "last_4", "card_last4"),
    expiryMonth: firstStringField([record], "expiryMonth", "expiry_month", "expiration_month"),
    expiryYear: firstStringField([record], "expiryYear", "expiry_year", "expiration_year"),
    createdAt: firstStringField(
      [record],
      "createdAt",
      "created_at",
      "issuedAt",
      "issued_at",
      "updatedAt",
      "updated_at",
    ),
    raw,
  };
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? 0 : parsed;
}

function pickMostRecentPaymentMethod(methods: PaymentMethodSummary[]): PaymentMethodSummary | undefined {
  if (methods.length === 0) {
    return undefined;
  }

  return [...methods].sort(
    (left, right) => parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt),
  )[0];
}

function isActivePaymentMethod(method: PaymentMethodSummary): boolean {
  const status = method.status?.trim().toLowerCase();

  if (!status) {
    return true;
  }

  return status === "active" || status === "open" || status === "issued";
}

function resolveVirtualCardId(env: Env, input: FetchFoodOrderCardInput = {}): string | undefined {
  return (
    input.paymentMethodId?.trim() ||
    input.cardId?.trim() ||
    env.SPONGE_VIRTUAL_CARD_ID?.trim() ||
    env.SPONGE_PAYMENT_METHOD_ID?.trim() ||
    env.SPONGE_CARD_ID?.trim() ||
    env.CARD_ID?.trim()
  );
}

function usesSpongePlatformAgent(env: Env, apiKey: string): boolean {
  if (apiKey.startsWith("sponge_master")) {
    return true;
  }

  const isDirectAgentKey =
    apiKey.startsWith("sponge_live_") ||
    apiKey.startsWith("sponge_test_") ||
    apiKey.startsWith("sp_");

  if (isDirectAgentKey) {
    return false;
  }

  return Boolean(env.SPONGE_AGENT_ID?.trim()) || Boolean(env.SPONGE_AGENT_NAME?.trim());
}

export function maskPan(pan: string | undefined): string | undefined {
  if (!pan) {
    return undefined;
  }

  const digits = pan.replace(/\D/g, "");

  if (digits.length < 4) {
    return "****";
  }

  return `****${digits.slice(-4)}`;
}

export function formatExpiry(card: {
  expiryMonth?: string;
  expiryYear?: string;
  expiration?: string;
}): string | undefined {
  if (card.expiration) {
    return card.expiration;
  }

  if (card.expiryMonth && card.expiryYear) {
    const year = card.expiryYear.length === 4 ? card.expiryYear.slice(-2) : card.expiryYear;
    return `${card.expiryMonth.padStart(2, "0")}/${year}`;
  }

  return undefined;
}

export function isUsableFoodOrderCard(card: FoodOrderCard | undefined): boolean {
  if (!card) {
    return false;
  }

  const pan = card.cardNumber?.replace(/\D/g, "") ?? "";

  if (pan.length < 13) {
    return false;
  }

  if (!card.cvc?.trim()) {
    return false;
  }

  return Boolean(formatExpiry(card));
}

export function lastFour(pan: string | undefined): string | undefined {
  if (!pan) {
    return undefined;
  }

  const digits = pan.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export class SpongeModule {
  private readonly env: Env;
  private readonly defaultAmountUsd: string;
  private readonly connection: Promise<SpongeConnection>;

  constructor(
    env: Env = process.env,
    wallet?: SpongeWalletLike,
    connect: SpongeWalletConnector = SpongeWallet.connect,
    connectPlatform: SpongePlatformConnector = SpongePlatform.connect,
  ) {
    this.env = env;
    this.defaultAmountUsd = envWithDefault(env, "SPONGE_FOOD_ORDER_CARD_AMOUNT_USD", "75");
    this.connection =
      wallet ?
        Promise.resolve({
          wallet,
          agentId: wallet.getAgentId?.() ?? "",
          apiKey: requiredEnv(env, "SPONGE_API_KEY"),
          baseUrl: envWithDefault(env, "SPONGE_API_BASE", "https://api.wallet.paysponge.com"),
        })
      : createSpongeConnection(env, connect, connectPlatform);
  }

  async getAddresses(): Promise<Record<string, string>> {
    const { wallet } = await this.connection;

    if (!wallet.getAddresses) {
      throw new Error("Sponge wallet does not support getAddresses");
    }

    return wallet.getAddresses();
  }

  async listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    const { agentId, apiKey, baseUrl } = await this.connection;
    const http = new HttpClient({ apiKey, baseUrl });

    try {
      const response = await http.get(`/api/agents/${encodeURIComponent(agentId)}/payment-methods`);
      return paymentMethodRecords(response)
        .map((record) => normalizePaymentMethodSummary(record))
        .filter((method): method is PaymentMethodSummary => Boolean(method));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("401") || message.includes("403")) {
        throw new Error(
          `Sponge denied access to payment methods for agent ${agentId}. Set SPONGE_CARD_ID or SPONGE_PAYMENT_METHOD_ID to fetch a known card.`,
        );
      }

      throw error;
    }
  }

  private pinnedCardId(): string | undefined {
    return (
      this.env.SPONGE_VIRTUAL_CARD_ID?.trim() ||
      this.env.SPONGE_PAYMENT_METHOD_ID?.trim() ||
      this.env.SPONGE_CARD_ID?.trim() ||
      this.env.CARD_ID?.trim() ||
      undefined
    );
  }

  private async fetchRainSpongeCard(input: FetchRainSpongeCardInput = {}): Promise<FoodOrderCard | null> {
    const { wallet } = await this.connection;

    if (!wallet.getCard) {
      throw new Error("Sponge wallet does not support getCard");
    }

    const cardType =
      input.cardType ??
      (envWithDefault(this.env, "SPONGE_CARD_TYPE", "rain") as "rain" | "basis_theory_vaulted");
    const raw = await wallet.getCard({
      card_type: cardType,
      payment_method_id: input.paymentMethodId?.trim() || this.pinnedCardId(),
      amount: input.amountUsd ?? this.defaultAmountUsd,
      currency: "USD",
      merchant_name: input.merchantName,
      merchant_url: input.merchantUrl,
    });
    const response = asRecord(raw);

    if (response.status === "selection_required") {
      return null;
    }

    const secretKey = stringField(response, "secret_key", "secretKey");
    const cardNumber =
      stringField(response, "card_number", "cardNumber", "number", "pan") ??
      decryptSpongeCardField(nestedEncryptedField(response, "encrypted_pan", "encryptedPan"), secretKey);
    const cvc =
      stringField(response, "cvc", "cvv", "securityCode", "security_code") ??
      decryptSpongeCardField(nestedEncryptedField(response, "encrypted_cvc", "encryptedCvc"), secretKey);
    const card = normalizeFoodOrderCard({
      ...response,
      card: {
        number: cardNumber,
        cvc,
        expiry_month: stringField(response, "expiration_month", "expiry_month", "expMonth", "exp_month"),
        expiry_year: stringField(response, "expiration_year", "expiry_year", "expYear", "exp_year"),
        cardholder_name: stringField(response, "cardholder_name", "cardholderName", "name"),
        id: stringField(response, "card_id", "cardId", "id"),
      },
      payment_method_id: stringField(response, "payment_method_id", "paymentMethodId"),
    });

    return isUsableFoodOrderCard(card) ? card : null;
  }

  async fetchFoodOrderCard(input: FetchFoodOrderCardInput = {}): Promise<FoodOrderCard> {
    const { wallet } = await this.connection;

    if (!wallet.getCard) {
      throw new Error("Sponge wallet does not support getCard");
    }

    const requestedId =
      input.paymentMethodId?.trim() || input.cardId?.trim() || this.pinnedCardId();

    if (!requestedId) {
      try {
        const methods = await this.listPaymentMethods();

        if (methods.length > 0) {
          const activeMethods = methods.filter(isActivePaymentMethod);
          const candidates = activeMethods.length > 0 ? activeMethods : methods;
          const metadata = pickMostRecentPaymentMethod(candidates);
          const card = await wallet.getCard({
            payment_method_id: metadata?.paymentMethodId,
            paymentMethodId: metadata?.paymentMethodId,
          });

          const normalized = normalizeFoodOrderCard(card, metadata);

          if (isUsableFoodOrderCard(normalized)) {
            return normalized;
          }
        }
      } catch {
        // Fall through to Sponge Card (Rain) fetch for agent keys without payment-method list access.
      }

      const rainCard = await this.fetchRainSpongeCard();

      if (rainCard) {
        return rainCard;
      }

      throw new Error(
        "No active Sponge card on this agent. Enroll Sponge Card or set SPONGE_VIRTUAL_CARD_ID.",
      );
    }

    const methods = await this.listPaymentMethods().catch(() => []);
    const metadata = methods.find(
      (method) => method.paymentMethodId === requestedId || method.cardId === requestedId,
    ) ?? {
      paymentMethodId: requestedId,
      raw: { id: requestedId },
    };
    const card = await wallet.getCard({
      payment_method_id: metadata.paymentMethodId,
      paymentMethodId: metadata.paymentMethodId,
    });
    const normalized = normalizeFoodOrderCard(card, metadata);

    if (isUsableFoodOrderCard(normalized)) {
      return normalized;
    }

    const rainCard = await this.fetchRainSpongeCard({ paymentMethodId: requestedId });

    if (rainCard) {
      return rainCard;
    }

    throw new Error("Unable to fetch usable card credentials for the requested Sponge card.");
  }

  /** Reuse session card or fetch latest active virtual card (never issues). */
  async fetchCheckoutCard(
    env: Env = this.env,
    options?: { virtualCardId?: string; existingCard?: FoodOrderCard },
  ): Promise<FoodOrderCard> {
    if (isUsableFoodOrderCard(options?.existingCard)) {
      return options.existingCard;
    }

    const virtualCardId = options?.virtualCardId?.trim() || resolveVirtualCardId(env);

    return this.fetchFoodOrderCard(
      virtualCardId ?
        { cardId: virtualCardId, paymentMethodId: virtualCardId }
      : {},
    );
  }

  async issueFoodOrderCard(input: IssueFoodOrderCardInput): Promise<FoodOrderCard> {
    const { wallet } = await this.connection;
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


const SPONGE_AGENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolvePlatformAgentId(
  platform: SpongePlatformLike & { listAgents(): Promise<Array<{ id: string; name: string }>> },
  agentIdOrName: string | undefined,
  fallbackName: string,
): Promise<string | undefined> {
  const raw = agentIdOrName?.trim();

  if (raw && SPONGE_AGENT_UUID_RE.test(raw)) {
    return raw;
  }

  const lookup = raw || fallbackName;
  const agents = await platform.listAgents();
  const match = agents.find((agent) => agent.name === lookup || agent.id === lookup);

  if (!match) {
    throw new Error(
      `No Sponge agent named "${lookup}". Set SPONGE_AGENT_ID to the agent UUID from the Sponge dashboard.`,
    );
  }

  return match.id;
}

async function createSpongeConnection(
  env: Env,
  connect: SpongeWalletConnector,
  connectPlatform: SpongePlatformConnector,
): Promise<SpongeConnection> {
  const baseUrl = envWithDefault(env, "SPONGE_API_BASE", "https://api.wallet.paysponge.com");
  const apiKey = requiredEnv(env, "SPONGE_API_KEY");
  const usePlatformAgent = apiKey.startsWith("sponge_master");

  if (!usePlatformAgent) {
    const wallet = await connect({ apiKey, baseUrl, noBrowser: true });

    return {
      wallet,
      agentId: wallet.getAgentId?.() ?? "",
      apiKey,
      baseUrl,
    };
  }

  const platform = await connectPlatform({ apiKey, baseUrl });
  const agentId = await resolvePlatformAgentId(
    platform as SpongePlatformLike & { listAgents(): Promise<Array<{ id: string; name: string }>> },
    env.SPONGE_AGENT_ID,
    envWithDefault(env, "SPONGE_AGENT_NAME", "Fasttab Foodrun Agent"),
  );
  const agentKey =
    agentId ? await platform.getAgentApiKey(agentId, apiKey.startsWith("sponge_test_"))
    : await createPlatformAgent(platform, env);

  if (!agentKey) {
    throw new Error("Sponge platform did not return an agent API key");
  }

  const wallet = await platform.connectAgent({ apiKey: agentKey, agentId });

  return {
    wallet,
    agentId: agentId ?? wallet.getAgentId?.() ?? "",
    apiKey: agentKey,
    baseUrl,
  };
}

async function createPlatformAgent(
  platform: SpongePlatformLike,
  env: Env,
): Promise<string> {
  const created = await platform.createAgent({
    name: envWithDefault(env, "SPONGE_AGENT_NAME", "Fasttab Foodrun Agent"),
    description: "Fasttab food-order checkout agent",
    dailySpendingLimit: env.SPONGE_DAILY_SPENDING_LIMIT_USD,
    weeklySpendingLimit: env.SPONGE_WEEKLY_SPENDING_LIMIT_USD,
    monthlySpendingLimit: env.SPONGE_MONTHLY_SPENDING_LIMIT_USD,
    isTestMode: true,
  });

  return created.apiKey;
}
