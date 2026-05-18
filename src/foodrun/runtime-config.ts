/**
 * Vercel / production env for hackathon SMS demo (set all for bulletproof demo):
 * - FOODRUN_DEMO_MODE=true — stub bakery search/cart, no Browser Use blockers in SMS, forced dry-run checkout
 * - FOODRUN_DEMO_FROM_START=true — same pipeline (optional; FOODRUN_DEMO_MODE alone is enough)
 * - FOODRUN_CHECKOUT_MODE=dry_run — never Sponge / live browser checkout (ignored when demo mode is on)
 */
import { envWithDefault, type Env } from "../env.js";
import type { FoodrunOrderState } from "./order-state.js";

export type FoodrunCheckoutMode = "dry_run" | "live";

/** User confirmed cart ("confirm order"); demo checkout may run after this gate. */
const DEMO_PAYMENT_APPROVED_STATES = new Set<FoodrunOrderState>([
  "issuing_card",
  "checking_out",
  "order_confirmed",
  "splitting_bill",
  "complete",
]);

export type FoodrunRuntimeConfig = {
  checkoutMode: FoodrunCheckoutMode;
};

export function foodrunRuntimeConfig(env: Env = process.env): FoodrunRuntimeConfig {
  const checkoutMode = envWithDefault(env, "FOODRUN_CHECKOUT_MODE", "dry_run");

  if (checkoutMode !== "dry_run" && checkoutMode !== "live") {
    throw new Error("FOODRUN_CHECKOUT_MODE must be dry_run or live");
  }

  return { checkoutMode };
}

export function shouldPlaceLiveOrders(env: Env = process.env): boolean {
  if (isDemoMode(env)) {
    return false;
  }

  return foodrunRuntimeConfig(env).checkoutMode === "live";
}

/** Hackathon SMS demo: stub restaurant/cart and/or post-approval checkout messaging. */
export function isDemoMode(env: Env = process.env): boolean {
  return envWithDefault(env, "FOODRUN_DEMO_MODE", "false").toLowerCase() === "true";
}

/** Legacy alias: demo-from-start is enabled whenever demo mode is on. */
export function isDemoFromStart(env: Env = process.env): boolean {
  return (
    isDemoMode(env) &&
    envWithDefault(env, "FOODRUN_DEMO_FROM_START", "false").toLowerCase() === "true"
  );
}

export function isDemoPaymentApproved(sessionState: FoodrunOrderState): boolean {
  return DEMO_PAYMENT_APPROVED_STATES.has(sessionState);
}

/** Stub restaurant search + demo catalog cart (any FOODRUN_DEMO_MODE). */
export function shouldUseDemoRestaurantPipeline(env: Env = process.env): boolean {
  return isDemoMode(env);
}

/** Skip Sponge/Browser Use checkout; dry-run + demo SMS. */
export function shouldUseDemoCheckout(
  _sessionState: FoodrunOrderState,
  env: Env = process.env,
): boolean {
  return isDemoMode(env);
}
