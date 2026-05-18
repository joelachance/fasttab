import { describe, expect, test } from "bun:test";

import {
  buildDemoCatalogCart,
  DEMO_CATALOG_CART_MARKER,
  demoRestaurantFromCriteria,
  isDemoCatalogCart,
} from "../src/modules/demo-catalog-cart.js";
import type { OrderCriteria } from "../src/types.js";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "506 20th St, San Francisco, CA 94107", placeName: "506 20th St, San Francisco" },
  cuisine: "Thai",
  pickupOrDelivery: "delivery",
  participantCount: 2,
  preferences: ["vegetarian"],
  allergies: [],
};

describe("demo-catalog-cart", () => {
  test("demoRestaurantFromCriteria returns Nari Thai Kitchen", () => {
    const restaurant = demoRestaurantFromCriteria(criteria);

    expect(restaurant.name).toBe("Nari Thai Kitchen");
    expect(restaurant.address).toContain("506 20th St");
    expect(restaurant.reason).not.toContain("demo");
  });

  test("buildDemoCatalogCart uses Thai SKUs and internal stub marker", () => {
    const restaurant = demoRestaurantFromCriteria(criteria);
    const cart = buildDemoCatalogCart(criteria, restaurant);

    expect(cart.status).toBe("draft");
    expect(cart.items).toHaveLength(2);
    expect(cart.estimatedTotal?.cents).toBe(1695 + 1795);
    expect(cart.blockers).toEqual([DEMO_CATALOG_CART_MARKER]);
    expect(isDemoCatalogCart(cart)).toBe(true);
    expect(cart.items[0]?.name).toBe("Pad Thai");
  });
});
