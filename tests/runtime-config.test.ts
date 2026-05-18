import { describe, expect, test } from "bun:test";

import {
  foodrunRuntimeConfig,
  isDemoFromStart,
  isDemoMode,
  isDemoPaymentApproved,
  shouldPlaceLiveOrders,
  shouldUseDemoCheckout,
  shouldUseDemoRestaurantPipeline,
} from "../src/foodrun/runtime-config";

describe("foodrunRuntimeConfig", () => {
  test("defaults checkout to dry run", () => {
    expect(foodrunRuntimeConfig({})).toEqual({ checkoutMode: "dry_run" });
    expect(shouldPlaceLiveOrders({})).toBe(false);
  });

  test("allows live checkout explicitly", () => {
    const env = { FOODRUN_CHECKOUT_MODE: "live" };

    expect(foodrunRuntimeConfig(env)).toEqual({ checkoutMode: "live" });
    expect(shouldPlaceLiveOrders(env)).toBe(true);
  });

  test("rejects unknown checkout modes", () => {
    expect(() => foodrunRuntimeConfig({ FOODRUN_CHECKOUT_MODE: "test" })).toThrow(
      "FOODRUN_CHECKOUT_MODE must be dry_run or live",
    );
  });

  test("demo mode is opt-in via FOODRUN_DEMO_MODE", () => {
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ FOODRUN_DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ FOODRUN_DEMO_MODE: "false" })).toBe(false);
  });

  test("demo from start requires FOODRUN_DEMO_FROM_START", () => {
    expect(isDemoFromStart({ FOODRUN_DEMO_MODE: "true" })).toBe(false);
    expect(
      isDemoFromStart({ FOODRUN_DEMO_MODE: "true", FOODRUN_DEMO_FROM_START: "true" }),
    ).toBe(true);
  });

  test("demo restaurant pipeline follows FOODRUN_DEMO_MODE", () => {
    expect(shouldUseDemoRestaurantPipeline({})).toBe(false);
    expect(shouldUseDemoRestaurantPipeline({ FOODRUN_DEMO_MODE: "true" })).toBe(true);
    expect(
      shouldUseDemoRestaurantPipeline({
        FOODRUN_DEMO_MODE: "true",
        FOODRUN_DEMO_FROM_START: "true",
      }),
    ).toBe(true);
  });

  test("demo mode forces dry-run checkout even when checkout mode is live", () => {
    const env = { FOODRUN_DEMO_MODE: "true", FOODRUN_CHECKOUT_MODE: "live" };

    expect(shouldPlaceLiveOrders(env)).toBe(false);
    expect(shouldUseDemoCheckout("confirming_cart", env)).toBe(true);
    expect(shouldUseDemoCheckout("issuing_card", env)).toBe(true);
  });

  test("demo checkout flag follows FOODRUN_DEMO_MODE", () => {
    expect(isDemoPaymentApproved("confirming_cart")).toBe(false);
    expect(isDemoPaymentApproved("issuing_card")).toBe(true);
    expect(shouldUseDemoCheckout("confirming_cart", { FOODRUN_DEMO_MODE: "true" })).toBe(true);
    expect(shouldUseDemoCheckout("issuing_card", { FOODRUN_DEMO_MODE: "true" })).toBe(true);
    expect(shouldUseDemoCheckout("confirming_cart", {})).toBe(false);
  });
});
