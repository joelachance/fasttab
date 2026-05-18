import { describe, expect, test } from "bun:test";

import {
  buildCartFromLineItems,
  buildInsomniaB9G3FCart,
  buildInsomniaCatalogCart,
  INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER,
  INSOMNIA_B9G3F_COOKIES_PER_BUNDLE,
  INSOMNIA_B9G3F_DEAL_NAME,
  INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE,
  INSOMNIA_B9G3F_PRODUCT_URL,
  INSOMNIA_DEFAULT_BUNDLE_COUNT,
  INSOMNIA_DEFAULT_LINE_ITEMS,
  insomniaCatalogCartEnabled,
  INSOMNIA_CATALOG_CART_NOTE,
  isInsomniaBrand,
  isInsomniaCatalogCart,
} from "../src/modules/insomnia-catalog-cart.js";
import type { OrderCriteria, RestaurantOption } from "../src/types.js";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "506 20th St, San Francisco, CA 94107", placeName: "506 20th St, San Francisco" },
  cuisine: "Insomnia Cookies",
  pickupOrDelivery: "delivery",
  participantCount: 3,
  preferences: ["Insomnia Cookies"],
  allergies: ["peanuts"],
  deliveryPhone: "+15551234567",
};

const restaurant: RestaurantOption = {
  name: "Insomnia Cookies",
  orderingUrl: "https://insomniacookies.com/",
  reason: "User requested Insomnia Cookies",
  dietaryFit: [],
};

describe("insomnia-catalog-cart", () => {
  test("isInsomniaBrand matches insomnia restaurant and preferences", () => {
    expect(isInsomniaBrand(restaurant, criteria)).toBe(true);
    expect(isInsomniaBrand({ ...restaurant, name: "Mission Thai" }, criteria)).toBe(true);
    expect(
      isInsomniaBrand(
        { name: "Mission Thai", reason: "Close", dietaryFit: [] },
        { ...criteria, cuisine: "Thai", preferences: [] },
      ),
    ).toBe(false);
  });

  test("buildInsomniaCatalogCart uses real cookie SKUs, prices, and delivery notes", () => {
    const cart = buildInsomniaCatalogCart(criteria, restaurant);

    expect(cart.status).toBe("draft");
    expect(cart.checkoutUrl).toBe("https://insomniacookies.com/");
    expect(cart.items).toHaveLength(3);
    expect(cart.items[0]).toMatchObject({
      name: "Classic Chocolate Chunk",
      quantity: 1,
      price: { currency: "usd", cents: 449 },
    });
    expect(cart.items[1]?.name).toBe("Deluxe Chocolate Chunk");
    expect(cart.items[2]?.name).toBe("Snickerdoodle");
    expect(cart.items.every((item) => (item.price?.cents ?? 0) >= 449 && (item.price?.cents ?? 0) <= 549)).toBe(
      true,
    );
    expect(cart.items[0]?.notes).toContain("506 20th St");
    expect(cart.items[0]?.notes).toContain("+15551234567");
    expect(cart.items[0]?.notes).toContain("peanuts");
    expect(cart.estimatedTotal?.cents).toBe(449 + 549 + 449);
    expect(cart.blockers).toEqual([INSOMNIA_CATALOG_CART_NOTE]);
    expect(isInsomniaCatalogCart(cart)).toBe(true);
  });

  test("buildInsomniaB9G3FCart models 2× Buy 9 Get 3 Free with placeholder pricing", () => {
    const cart = buildInsomniaB9G3FCart(criteria, restaurant);

    expect(cart.checkoutUrl).toBe(INSOMNIA_B9G3F_PRODUCT_URL);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      name: INSOMNIA_B9G3F_DEAL_NAME,
      quantity: INSOMNIA_DEFAULT_BUNDLE_COUNT,
      price: { currency: "usd", cents: INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER },
    });
    expect(cart.estimatedTotal?.cents).toBe(
      INSOMNIA_B9G3F_BUNDLE_CENTS_PLACEHOLDER * INSOMNIA_DEFAULT_BUNDLE_COUNT,
    );
    expect(cart.items[0]?.notes).toContain("506 20th St");
    expect(cart.items[0]?.notes).toContain("9 paid + 3 free");
    for (const flavor of INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE) {
      expect(cart.items[0]?.notes).toContain(flavor.name);
    }
    expect(cart.blockers.some((note) => note.includes("placeholder"))).toBe(true);
    expect(isInsomniaCatalogCart(cart)).toBe(true);
    expect(INSOMNIA_B9G3F_COOKIES_PER_BUNDLE).toBe(12);
  });

  test("buildCartFromLineItems uses fixed SKU quantities from INSOMNIA_DEFAULT_LINE_ITEMS", () => {
    const cart = buildCartFromLineItems(criteria, restaurant, INSOMNIA_DEFAULT_LINE_ITEMS);

    expect(cart.items).toHaveLength(4);
    expect(cart.items.map((item) => ({ name: item.name, quantity: item.quantity }))).toEqual([
      { name: "Chocolate Chunk", quantity: 3 },
      { name: "Cookies 'N Cream", quantity: 3 },
      { name: "Classic with M&M'S", quantity: 3 },
      { name: "Vegan Chocolate Chunk", quantity: 3 },
    ]);
    expect(cart.estimatedTotal?.cents).toBe(449 * 12);
  });

  test("insomniaCatalogCartEnabled defaults to true", () => {
    expect(insomniaCatalogCartEnabled({})).toBe(true);
    expect(insomniaCatalogCartEnabled({ FOODRUN_INSOMNIA_CATALOG_CART: "false" })).toBe(false);
  });
});
