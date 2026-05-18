import type { CartSummary, OrderCriteria, RestaurantOption } from "../types.js";

export const DEMO_CATALOG_CART_SESSION_ID = "demo_catalog_cart";
export const DEMO_RESTAURANT_NAME = "Nari Thai Kitchen";
/** Internal marker for stub carts; never shown in SMS. */
export const DEMO_CATALOG_CART_MARKER = "__fasttab_stub_cart__";

const DEMO_CHECKOUT_URL = "https://order.narithai.example/menu";

const DEMO_MENU = [
  { name: "Pad Thai", cents: 1695 },
  { name: "Green Curry", cents: 1795 },
  { name: "Drunken Noodles", cents: 1745 },
  { name: "Tom Yum Soup", cents: 1295 },
  { name: "Thai Iced Tea", cents: 495 },
] as const;

export function demoRestaurantFromCriteria(criteria: OrderCriteria): RestaurantOption {
  return {
    name: DEMO_RESTAURANT_NAME,
    orderingUrl: DEMO_CHECKOUT_URL,
    reason: "Highly rated Thai near Mission",
    dietaryFit: criteria.preferences ?? [],
    address: criteria.location.placeName ?? criteria.location.raw,
  };
}

export function isDemoCatalogCart(cart: CartSummary): boolean {
  return cart.blockers.some((blocker) => blocker.includes(DEMO_CATALOG_CART_MARKER));
}

export function buildDemoCatalogCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): CartSummary {
  const itemCount = Math.max(1, Math.min(criteria.participantCount, 6));
  const deliveryNote = deliveryNotes(criteria);
  const items = Array.from({ length: itemCount }, (_, index) => {
    const dish = DEMO_MENU[index % DEMO_MENU.length];

    return {
      name: dish.name,
      quantity: 1,
      price: { currency: "usd" as const, cents: dish.cents },
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
    blockers: [DEMO_CATALOG_CART_MARKER],
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
