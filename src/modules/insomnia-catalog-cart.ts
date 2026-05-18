import { envWithDefault, type Env } from "../env.js";
import type { CartSummary, OrderCriteria, RestaurantOption } from "../types.js";

const INSOMNIA_BRAND_PATTERN = /\binsomnia cookies?\b|\binsomnia\b.*\bcookies?\b/i;
const INSOMNIA_HOST_PATTERN = /insomniacookies\.com/i;

export const INSOMNIA_CATALOG_CART_SESSION_ID = "insomnia_catalog_cart";

export const INSOMNIA_CATALOG_CART_NOTE =
  "Built from Insomnia menu catalog for FastTab demo; complete checkout on insomniacookies.com";

const INSOMNIA_CHECKOUT_URL = "https://insomniacookies.com/";

/** Buy 9 Get 3 Free — 12 cookies per bundle (9 paid + 3 free). */
export const INSOMNIA_B9G3F_PRODUCT_URL = "https://insomniacookies.com/products/buy-9-get-3-free-1";
export const INSOMNIA_B9G3F_DEAL_NAME = "Buy 9 Get 3 Free";
export const INSOMNIA_B9G3F_COOKIES_PER_BUNDLE = 12;
export const INSOMNIA_B9G3F_PAID_PER_BUNDLE = 9;
export const INSOMNIA_B9G3F_FREE_PER_BUNDLE = 3;
/** Placeholder per bundle; confirm live price at checkout on insomniacookies.com. */
export const INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER = 4499;
export const INSOMNIA_DEFAULT_BUNDLE_COUNT = 2;

/** Suggested flavors per bundle (3 each × 4 SKUs = 12); pick paid + free slots on the deal page. */
export const INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE = [
  { name: "Chocolate Chunk", quantity: 3 },
  { name: "Cookies 'N Cream", quantity: 3 },
  { name: "Classic with M&M'S", quantity: 3 },
  { name: "Vegan Chocolate Chunk", quantity: 3 },
] as const;

const INSOMNIA_MENU = [
  { name: "Classic Chocolate Chunk", cents: 449 },
  { name: "Deluxe Chocolate Chunk", cents: 549 },
  { name: "Snickerdoodle", cents: 449 },
  { name: "Sugar Rush", cents: 499 },
  { name: "Confetti Deluxe", cents: 549 },
  { name: "Double Chocolate Mint", cents: 499 },
  { name: "Chocolate Chunk", cents: 449 },
  { name: "Cookies 'N Cream", cents: 449 },
  { name: "Classic with M&M'S", cents: 449 },
  { name: "Vegan Chocolate Chunk", cents: 449 },
] as const;

export const INSOMNIA_DEFAULT_LINE_ITEMS = [
  { name: "Chocolate Chunk", quantity: 3 },
  { name: "Cookies 'N Cream", quantity: 3 },
  { name: "Classic with M&M'S", quantity: 3 },
  { name: "Vegan Chocolate Chunk", quantity: 3 },
] as const;

type InsomniaLineItemSpec = { name: string; quantity: number };

function insomniaMenuPrice(name: string): number {
  const cookie = INSOMNIA_MENU.find((entry) => entry.name === name);

  if (!cookie) {
    throw new Error(`Unknown Insomnia menu item: ${name}`);
  }

  return cookie.cents;
}

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

function formatB9G3FFlavorSummary(): string {
  return INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE.map((line) => `${line.quantity}× ${line.name}`).join(", ");
}

export function buildInsomniaB9G3FCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  bundleCount: number = INSOMNIA_DEFAULT_BUNDLE_COUNT,
): CartSummary {
  const deliveryNote = deliveryNotes(criteria);
  const flavorSummary = formatB9G3FFlavorSummary();
  const perBundleNote =
    `Each bundle: ${INSOMNIA_B9G3F_COOKIES_PER_BUNDLE} cookies (${INSOMNIA_B9G3F_PAID_PER_BUNDLE} paid + ${INSOMNIA_B9G3F_FREE_PER_BUNDLE} free). Suggested flavors: ${flavorSummary}. Choose flavors on the deal product page.`;
  const dealNote = `Add ${bundleCount}× "${INSOMNIA_B9G3F_DEAL_NAME}" (${INSOMNIA_B9G3F_PRODUCT_URL}). ${perBundleNote}`;
  const priceNote =
    `Estimated ${bundleCount}× @$${(INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER / 100).toFixed(2)} each (placeholder—site price applies at checkout).`;
  const itemNotes = [deliveryNote, dealNote, priceNote].filter(Boolean).join(" ");

  const subtotalCents = INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER * bundleCount;

  return {
    restaurantName: restaurant.name,
    checkoutUrl: INSOMNIA_B9G3F_PRODUCT_URL,
    items: [
      {
        name: INSOMNIA_B9G3F_DEAL_NAME,
        quantity: bundleCount,
        price: { currency: "usd", cents: INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER },
        notes: itemNotes,
      },
    ],
    subtotal: { currency: "usd", cents: subtotalCents },
    estimatedTotal: { currency: "usd", cents: subtotalCents },
    screenshots: [],
    status: "draft",
    blockers: [dealNote, priceNote, INSOMNIA_CATALOG_CART_NOTE],
  };
}

export function buildCartFromLineItems(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  lineItems: readonly InsomniaLineItemSpec[],
): CartSummary {
  const deliveryNote = deliveryNotes(criteria);
  const items = lineItems.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    price: { currency: "usd" as const, cents: insomniaMenuPrice(line.name) },
    notes: deliveryNote,
  }));
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

export function buildInsomniaCatalogCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): CartSummary {
  const cookieCount = Math.max(1, Math.min(criteria.participantCount, 12));
  const lineItems = Array.from({ length: cookieCount }, (_, index) => ({
    name: INSOMNIA_MENU[index % INSOMNIA_MENU.length].name,
    quantity: 1,
  }));

  return buildCartFromLineItems(criteria, restaurant, lineItems);
}

function deliveryNotes(criteria: OrderCriteria): string | undefined {
  const parts = [
    criteria.pickupOrDelivery === "delivery" ?
      `Deliver to ${criteria.location.placeName ?? criteria.location.raw}`
    : undefined,
    criteria.deliveryPhone ? `Phone: ${criteria.deliveryPhone}` : undefined,
    criteria.deliveryEmail ? `Email: ${criteria.deliveryEmail}` : undefined,
    criteria.allergies.length ? `Allergies: ${criteria.allergies.join(", ")}` : undefined,
    criteria.preferences.length ? criteria.preferences.join("; ") : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(". ") : undefined;
}
