import Stripe from "stripe";

import { envWithDefault, requiredEnv, type Env } from "../../env.js";
import type { AgentCardholder, AgentVirtualCard } from "./types.js";

export type StripeClientLike = {
  prices: {
    create(
      params: Stripe.PriceCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
  };
  paymentLinks: {
    create(
      params: Stripe.PaymentLinkCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ url: string }>;
  };
  issuing?: {
    cardholders: {
      create(
        params: Stripe.Issuing.CardholderCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<AgentCardholder>;
    };
    cards: {
      create(
        params: Stripe.Issuing.CardCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<AgentVirtualCard>;
    };
  };
};

export function createStripeClient(env: Env = process.env): StripeClientLike {
  const apiKey = requiredEnv(env, "STRIPE_SECRET_KEY");
  const host = new URL(envWithDefault(env, "STRIPE_API_BASE", "https://api.stripe.com")).host;

  return new Stripe(apiKey, {
    host,
    maxNetworkRetries: 2,
    timeout: 20_000,
    typescript: true,
  });
}
