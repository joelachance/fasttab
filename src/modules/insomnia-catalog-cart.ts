import { envWithDefault, type Env } from "../env.js";
import type { CartSummary, OrderCriteria, RestaurantOption } from "../types.js";

const INSOMNIA_BRAND_PATTERN = /\binsomnia cookies?\b|\binsomnia\b.*\bcookies?\b/i;
const INSOMNIA_HOST_PATTERN = /insomniacookies\.com/i;

export const INSOMNIA_CATALOG_CART_SESSION_ID = "insomnia_catalog_cart";

export const INSOMNIA_CATALOG_CART_NOTE =
  "Built from Insomnia menu catalog for FastTab demo; complete checkout on insomniacookies.com";

const INSOMNIA_CHECKOUT_URL = "https://insomniacookies.com/";

const INSOMNIA_MENU = [
  { name: "Classic Chocolate Chunk", cents: 449 },
  { name: "Deluxe Chocolate Chunk", cents: 549 },
  { name: "Snickerdoodle", cents: 449 },
  { name: "Sugar Rush", cents: 499 },
  { name: "Confetti Deluxe", cents: 549 },
  { name: "Double Chocolate Mint", cents: 499 },
] as const;

export function insomniaCatalogCartEnabled(env: Env = process.env): boolean {
  return envWithDefault(env, "FOODRUN_INSOMNIA_CATALOG_CART", "true").toLowerCase() !== "false";
}

export function isInsomniaBrand(restaurant: RestaurantOption, criteria?: OrderCriteria): boolean {
  const haystack = [
    restaurant.name,
    restaurant.reason,
    restaurant.orderingUrl ?? "",
    restaurant.url ?? "",
    criteria?.cuisine ?? "",
    ...(criteria?.preferences ?? []),
  ].join(" ");

  return INSOMNIA_BRAND_PATTERN.test(haystack) || INSOMNIA_HOST_PATTERN.test(haystack);
}

export function isInsomniaCatalogCart(cart: CartSummary): boolean {
  return cart.blockers.some((blocker) => blocker.includes("Insomnia menu catalog"));
}

export function buildInsomniaCatalogCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): CartSummary {
  const cookieCount = Math.max(1, Math.min(criteria.participantCount, 12));
  const deliveryNote = deliveryNotes(criteria);
  const items = Array.from({ length: cookieCount }, (_, index) => {
    const cookie = INSOMNIA_MENU[index % INSOMNIA_MENU.length];

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
    checkoutUrl: INSOMNIA_CHECKOUT_URL,
    items,
    subtotal: { currency: "usd", cents: subtotalCents },
    estimatedTotal: { currency: "usd", cents: subtotalCents },
    screenshots: [],
    status: "draft",
    blockers: [INSOMNIA_CATALOG_CART_NOTE],
  };
}

function deliveryNotes(criteria: OrderCriteria): string | undefined {
  const parts = [
    criteria.pickupOrDelivery === "delivery" ?
      `Deliver to ${criteria.location.placeName ?? criteria.location.raw}`
    : undefined,
    criteria.deliveryPhone ? `Phone: ${criteria.deliveryPhone}` : undefined,
    criteria.allergies.length ? `Allergies: ${criteria.allergies.join(", ")}` : undefined,
    criteria.preferences.length ? criteria.preferences.join("; ") : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(". ") : undefined;
}
