import { describe, expect, test } from "bun:test";

import {
  buildDemoCatalogCart,
  DEMO_CATALOG_CART_NOTE,
  demoRestaurantFromCriteria,
  isDemoCatalogCart,
} from "../src/modules/demo-catalog-cart.js";
import type { OrderCriteria } from "../src/types.js";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "506 20th St, San Francisco, CA 94107", placeName: "506 20th St, San Francisco" },
  cuisine: "Cookies",
  pickupOrDelivery: "delivery",
  participantCount: 2,
  preferences: ["cookies"],
  allergies: [],
};

describe("demo-catalog-cart", () => {
  test("demoRestaurantFromCriteria returns FastTab Demo Bakery", () => {
    const restaurant = demoRestaurantFromCriteria(criteria);

    expect(restaurant.name).toBe("FastTab Demo Bakery");
    expect(restaurant.address).toContain("506 20th St");
  });

  test("buildDemoCatalogCart uses cookie SKUs and demo blocker note", () => {
    const restaurant = demoRestaurantFromCriteria(criteria);
    const cart = buildDemoCatalogCart(criteria, restaurant);

    expect(cart.status).toBe("draft");
    expect(cart.items).toHaveLength(2);
    expect(cart.estimatedTotal?.cents).toBe(449 + 549);
    expect(cart.blockers).toEqual([DEMO_CATALOG_CART_NOTE]);
    expect(isDemoCatalogCart(cart)).toBe(true);
  });
});
