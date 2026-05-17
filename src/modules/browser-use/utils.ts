import type { SessionResult } from "browser-use-sdk/v3";

import type { BrowserPromptOutput } from "./index.js";
import type { CartSummary, Money, RestaurantOption } from "../../types.js";

export type NormalizedBrowserPromptOutput = {
  summary: string;
  restaurants: RestaurantOption[];
  cart?: CartSummary;
  blockers: string[];
  nextSteps: string[];
};

export type BrowserRunMetadata = {
  sessionId: string;
  liveUrl?: string;
  status?: string;
  model?: string;
  stepCount?: number;
  totalCost?: Money;
};

export function normalizeBrowserPromptOutput(
  output: BrowserPromptOutput,
): NormalizedBrowserPromptOutput {
  const normalized: NormalizedBrowserPromptOutput = {
    summary: output.summary,
    restaurants: output.restaurants.map((restaurant) => ({
      name: restaurant.name,
      url: restaurant.url,
      orderingUrl: restaurant.orderingUrl,
      address: restaurant.address,
      reason: restaurant.reason,
      estimatedPickupTime: restaurant.estimatedPickupTime,
      estimatedTotal:
        restaurant.estimatedTotalUsd === undefined ?
          undefined
        : usd(restaurant.estimatedTotalUsd),
      dietaryFit: restaurant.dietaryFit,
    })),
    blockers: output.blockers,
    nextSteps: output.nextSteps,
  };

  if (output.cart) {
    normalized.cart = {
      restaurantName: output.cart.restaurantName,
      checkoutUrl: output.cart.checkoutUrl,
      items: output.cart.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        assignedTo: item.assignedTo,
        notes: item.notes,
        price: item.priceUsd === undefined ? undefined : usd(item.priceUsd),
      })),
      subtotal:
        output.cart.subtotalUsd === undefined ? undefined : usd(output.cart.subtotalUsd),
      taxesAndFees:
        output.cart.taxesAndFeesUsd === undefined ?
          undefined
        : usd(output.cart.taxesAndFeesUsd),
      estimatedTotal:
        output.cart.estimatedTotalUsd === undefined ?
          undefined
        : usd(output.cart.estimatedTotalUsd),
      screenshots: output.cart.screenshots,
      status: output.cart.status,
      blockers: output.cart.blockers,
    };
  }

  return normalized;
}

export function browserRunMetadata(result: {
  sessionId: string;
  liveUrl?: string;
  raw: Partial<SessionResult<unknown>>;
}): BrowserRunMetadata {
  const metadata: BrowserRunMetadata = {
    sessionId: result.sessionId,
    liveUrl: result.liveUrl ?? result.raw.liveUrl ?? undefined,
    status: result.raw.status,
    model: result.raw.model,
    stepCount: result.raw.stepCount,
  };
  const totalCostUsd = result.raw.totalCostUsd;

  if (typeof totalCostUsd === "string" && totalCostUsd) {
    metadata.totalCost = usd(Number(totalCostUsd));
  }

  return metadata;
}

export function selectRestaurant(
  output: NormalizedBrowserPromptOutput,
  selection: number | string,
): RestaurantOption {
  if (typeof selection === "number") {
    if (selection < 1 || selection > output.restaurants.length) {
      throw new Error(`Restaurant selection out of range: ${selection}`);
    }

    return output.restaurants[selection - 1]!;
  }

  const normalized = selection.trim().toLowerCase();
  const exact = output.restaurants.find(
    (restaurant) => restaurant.name.toLowerCase() === normalized,
  );

  if (exact) {
    return exact;
  }

  const partial = output.restaurants.find((restaurant) =>
    restaurant.name.toLowerCase().includes(normalized),
  );

  if (partial) {
    return partial;
  }

  throw new Error(`Restaurant not found: ${selection}`);
}

export function buildCartPromptFromRestaurant(input: {
  originalRequest: string;
  restaurant: RestaurantOption;
  extraInstructions?: string;
}): string {
  return `
Build a takeout cart from this selected restaurant. Do not place the order. Do not enter payment information. Stop before payment and report blockers.
Prefer Toast ordering pages first. If the URL is DoorDash, Uber Eats, Grubhub, or cannot build a guest cart, search for Toast, Square, ChowNow, BentoBox, Shopify, or the official restaurant ordering page. If that still cannot build a guest cart, try a comparable nearby restaurant.

Original request:
${input.originalRequest}

Restaurant:
- Name: ${input.restaurant.name}
- URL: ${input.restaurant.orderingUrl ?? input.restaurant.url ?? "not provided"}

${input.extraInstructions ? `Extra instructions:\n${input.extraInstructions}` : ""}

Return JSON with summary, optional cart, blockers, and nextSteps. Cart status must be draft, checkout_ready, or blocked.
`.trim();
}

export function formatRestaurantOptionsForSms(
  output: NormalizedBrowserPromptOutput,
): string {
  const lines = [
    output.summary,
    ...output.restaurants.map((restaurant, index) => {
      const details = [
        restaurant.estimatedTotal ? `est. ${formatMoney(restaurant.estimatedTotal)}` : undefined,
        restaurant.estimatedPickupTime,
      ].filter((detail): detail is string => Boolean(detail));

      return `${index + 1}. ${restaurant.name}${details.length ? `, ${details.join(", ")}` : ""}`;
    }),
    "Reply with a number to pick one.",
  ];

  return lines.join("\n");
}

export function formatMoney(money: Money): string {
  return `$${(money.cents / 100).toFixed(2)}`;
}

function usd(n: number): Money {
  return { currency: "usd", cents: Math.round(n * 100) };
}
