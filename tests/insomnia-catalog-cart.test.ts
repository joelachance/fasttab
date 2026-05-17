import { describe, expect, test } from "bun:test";

import {
  buildInsomniaCatalogCart,
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
    expect(cart.items[0]?.notes).toContain("peanuts");
    expect(cart.estimatedTotal?.cents).toBe(449 + 549 + 449);
    expect(cart.blockers).toEqual([INSOMNIA_CATALOG_CART_NOTE]);
    expect(isInsomniaCatalogCart(cart)).toBe(true);
  });

  test("insomniaCatalogCartEnabled defaults to true", () => {
    expect(insomniaCatalogCartEnabled({})).toBe(true);
    expect(insomniaCatalogCartEnabled({ FOODRUN_INSOMNIA_CATALOG_CART: "false" })).toBe(false);
  });
});
