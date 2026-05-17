import { describe, expect, test } from "bun:test";

import { stubDoorDashCheckout } from "../src/modules/checkout-stub";

describe("checkout stub", () => {
  test("returns a fake DoorDash checkout result", () => {
    const checkout = stubDoorDashCheckout({
      restaurantName: "Demo Thai",
      totalCents: 9217,
    });

    expect(checkout.merchant).toBe("doordash_demo");
    expect(checkout.restaurantName).toBe("Demo Thai");
    expect(checkout.total).toEqual({ currency: "usd", cents: 9217 });
    expect(checkout.status).toBe("checkout_ready_demo");
    expect(checkout.orderId).toMatch(/^demo_dd_/);
  });
});
