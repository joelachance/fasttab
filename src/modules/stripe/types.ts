export type StripePaymentLink = {
  participantId: string;
  phoneNumber: string;
  amountCents: number;
  url: string;
};

export type AgentCardholderInput = {
  agentId: string;
  name: string;
  email?: string;
  billingAddress: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

export type AgentCardholder = { id: string; status?: string };

export type AgentCardSpendRequest = {
  roomId: string;
  agentId: string;
  cardholderId: string;
  amountCents: number;
  currency?: "usd";
  merchantName?: string;
  allowedMerchantCategories?: StripeMerchantCategory[];
};

export type AgentVirtualCard = { id: string; status?: string; last4?: string };

export type StripeMerchantCategory = NonNullable<
  NonNullable<
    Parameters<import("stripe").Stripe["issuing"]["cards"]["create"]>[0]["spending_controls"]
  >["allowed_categories"]
>[number];
