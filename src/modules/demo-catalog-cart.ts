import type { CartSummary, OrderCriteria, RestaurantOption } from "../types.js";

export const DEMO_CATALOG_CART_SESSION_ID = "demo_catalog_cart";
export const DEMO_RESTAURANT_NAME = "FastTab Demo Bakery";
export const DEMO_CATALOG_CART_NOTE =
  "FastTab hackathon demo — not a real order. No browser or restaurant checkout.";

const DEMO_CHECKOUT_URL = "https://fasttab.demo/";

const DEMO_MENU = [
  { name: "Classic Chocolate Chunk", cents: 449 },
  { name: "Deluxe Chocolate Chunk", cents: 549 },
  { name: "Snickerdoodle", cents: 449 },
  { name: "Sugar Rush", cents: 499 },
  { name: "Confetti Deluxe", cents: 549 },
] as const;

export function demoRestaurantFromCriteria(criteria: OrderCriteria): RestaurantOption {
  return {
    name: DEMO_RESTAURANT_NAME,
    orderingUrl: DEMO_CHECKOUT_URL,
    reason: DEMO_CATALOG_CART_NOTE,
    dietaryFit: criteria.preferences ?? [],
    address: criteria.location.placeName ?? criteria.location.raw,
  };
}

export function isDemoCatalogCart(cart: CartSummary): boolean {
  return cart.blockers.some((blocker) => blocker.includes("hackathon demo"));
}

export function buildDemoCatalogCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): CartSummary {
  const cookieCount = Math.max(1, Math.min(criteria.participantCount, 6));
  const deliveryNote = deliveryNotes(criteria);
  const items = Array.from({ length: cookieCount }, (_, index) => {
    const cookie = DEMO_MENU[index % DEMO_MENU.length];

    return {
      name: cookie.name,
      quantity: 1,
      price: { currency: "usd" as const, cents: cookie.cents },
      notes: deliveryNote,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + (item.price?.cents ?? 0) * item.quantity, 0);

  return {
    restaurantName: restaurant.name,
    checkoutUrl: DEMO_CHECKOUT_URL,
    items,
    subtotal: { currency: "usd", cents: subtotalCents },
    estimatedTotal: { currency: "usd", cents: subtotalCents },
    screenshots: [],
    status: "draft",
    blockers: [DEMO_CATALOG_CART_NOTE],
  };
}

function deliveryNotes(criteria: OrderCriteria): string | undefined {
  const parts = [
    criteria.pickupOrDelivery === "delivery" ?
      `Deliver to ${criteria.location.placeName ?? criteria.location.raw}`
    : undefined,
    criteria.allergies.length ? `Allergies: ${criteria.allergies.join(", ")}` : undefined,
    criteria.preferences.length ? criteria.preferences.join("; ") : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(". ") : undefined;
}
