import type { CartSummary, Money } from "../../types.js";

export type StubDoorDashCheckoutInput = {
  restaurantName?: string;
  cart?: CartSummary;
  totalCents?: number;
};

export type StubDoorDashCheckoutResult = {
  orderId: string;
  merchant: "doordash_demo";
  restaurantName: string;
  total: Money;
  status: "checkout_ready_demo";
  message: string;
};

export function stubDoorDashCheckout(
  input: StubDoorDashCheckoutInput = {},
): StubDoorDashCheckoutResult {
  const restaurantName =
    input.restaurantName ?? input.cart?.restaurantName ?? "Demo Thai (DoorDash)";
  const totalCents =
    input.totalCents ?? input.cart?.estimatedTotal?.cents ?? input.cart?.subtotal?.cents ?? 9217;

  if (totalCents <= 0) {
    throw new Error("DoorDash demo checkout total must be positive");
  }

  return {
    orderId: `demo_dd_${Date.now()}`,
    merchant: "doordash_demo",
    restaurantName,
    total: { currency: "usd", cents: totalCents },
    status: "checkout_ready_demo",
    message:
      "Demo-only DoorDash checkout prepared. No restaurant was charged; collect shares with Stripe test Payment Links.",
  };
}
