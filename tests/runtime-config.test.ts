import { describe, expect, test } from "bun:test";

import { foodrunRuntimeConfig, isDemoMode, shouldPlaceLiveOrders } from "../src/foodrun/runtime-config";

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
});
