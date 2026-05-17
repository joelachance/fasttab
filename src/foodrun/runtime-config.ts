import { envWithDefault, type Env } from "../env.js";

export type FoodrunCheckoutMode = "dry_run" | "live";

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
  return foodrunRuntimeConfig(env).checkoutMode === "live";
}
