import { describe, expect, test } from "bun:test";

import type { BrowserPromptOutput } from "../src/modules/browser-use";
import {
  browserRunMetadata,
  buildCartPromptFromRestaurant,
  formatRestaurantOptionsForSms,
  normalizeBrowserPromptOutput,
  selectRestaurant,
} from "../src/modules/browser-use/utils";

const output: BrowserPromptOutput = {
  summary: "Found two Thai options.",
  restaurants: [
    {
      name: "Basil Cafe Thai Cuisine",
      url: "https://basil.example.com",
      orderingUrl: "https://basil.example.com/order",
      reason: "Close, Thai, and good group options.",
      estimatedPickupTime: "15-20 min",
      estimatedTotalUsd: 71.5,
      dietaryFit: ["vegetarian options"],
    },
    {
      name: "Thai Garden",
      reason: "Backup Thai option.",
      dietaryFit: [],
    },
  ],
  blockers: [],
  nextSteps: ["Pick one."],
};

describe("Browser Use utils", () => {
  test("normalize maps restaurant estimatedTotalUsd to Money cents", () => {
    const normalized = normalizeBrowserPromptOutput(output);

    expect(normalized.restaurants[0]?.estimatedTotal?.cents).toBe(7150);
  });

  test("normalize maps cart USD fields to Money cents", () => {
    const normalized = normalizeBrowserPromptOutput({
      ...output,
      cart: {
        restaurantName: "Basil Cafe Thai Cuisine",
        checkoutUrl: "https://basil.example.com/cart",
        items: [{ name: "Pad Thai", quantity: 2, priceUsd: 15.95 }],
        subtotalUsd: 31.9,
        taxesAndFeesUsd: 3.15,
        estimatedTotalUsd: 35.05,
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    });

    expect(normalized.cart?.status).toBe("checkout_ready");
    expect(normalized.cart?.items[0]?.price?.cents).toBe(1595);
    expect(normalized.cart?.subtotal?.cents).toBe(3190);
    expect(normalized.cart?.taxesAndFees?.cents).toBe(315);
    expect(normalized.cart?.estimatedTotal?.cents).toBe(3505);
  });

  test("browserRunMetadata extracts status, model, steps, and cost", () => {
    const metadata = browserRunMetadata({
      sessionId: "session_123",
      liveUrl: "https://live.example.com",
      raw: {
        status: "stopped",
        model: "bu-max",
        stepCount: 10,
        totalCostUsd: "0.463895",
      },
    });

    expect(metadata).toEqual({
      sessionId: "session_123",
      liveUrl: "https://live.example.com",
      status: "stopped",
      model: "bu-max",
      stepCount: 10,
      totalCost: { currency: "usd", cents: 46 },
    });
  });

  test("selectRestaurant supports 1-based index and fuzzy name", () => {
    const normalized = normalizeBrowserPromptOutput(output);

    expect(selectRestaurant(normalized, 2).name).toBe("Thai Garden");
    expect(selectRestaurant(normalized, "basil").name).toBe("Basil Cafe Thai Cuisine");
    expect(() => selectRestaurant(normalized, 3)).toThrow("out of range");
  });

  test("buildCartPromptFromRestaurant includes safety rails, URL, and extra instructions", () => {
    const normalized = normalizeBrowserPromptOutput(output);
    const prompt = buildCartPromptFromRestaurant({
      originalRequest: "Thai pickup for 4",
      restaurant: normalized.restaurants[0]!,
      extraInstructions: "Avoid peanuts",
    });

    expect(prompt).toContain("Do not place the order");
    expect(prompt).toContain("Prefer Toast ordering pages first");
    expect(prompt).toContain("currently available");
    expect(prompt).toContain("https://basil.example.com/order");
    expect(prompt).toContain("Avoid peanuts");
  });

  test("formatRestaurantOptionsForSms includes numbered options and reply instruction", () => {
    const normalized = normalizeBrowserPromptOutput(output);
    const sms = formatRestaurantOptionsForSms(normalized);

    expect(sms).toContain("1. Basil Cafe Thai Cuisine, est. $71.50, 15-20 min");
    expect(sms).toContain("Reply with a number");
  });
});
