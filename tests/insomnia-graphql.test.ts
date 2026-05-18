import { describe, expect, test } from "bun:test";

import {
  flavorPicksForBundles,
  INSOMNIA_B9G3F_PRODUCT_ID,
  INSOMNIA_SF_SOMA_STORE_ID,
  InsomniaGraphqlClient,
} from "../src/modules/insomnia-graphql.js";

describe("insomnia-graphql", () => {
  test("flavorPicksForBundles totals 24 cookies for 2 bundles", () => {
    const picks = flavorPicksForBundles(2);
    const total = picks.reduce((sum, pick) => sum + pick.quantity, 0);

    expect(total).toBe(24);
    expect(picks.length).toBe(4);
  });

  test("createCart against live API (SoMa store)", async () => {
    const client = new InsomniaGraphqlClient({ storeId: INSOMNIA_SF_SOMA_STORE_ID });
    const result = await client.createDeliveryCart({
      address: {
        address1: "560 20th St",
        city: "San Francisco",
        state: "CA",
        postcode: "94107",
        lat: 37.7604,
        lng: -122.3874,
      },
    });

    expect(result.body.errors).toBeUndefined();
    expect(result.body.data?.createCart.code).toMatch(/^[a-f0-9]{32}$/);
  }, 20_000);

  test("addProductToOrderV2 for B9G3F on live cart", async () => {
    const client = new InsomniaGraphqlClient({ storeId: INSOMNIA_SF_SOMA_STORE_ID });
    const create = await client.createDeliveryCart({
      address: {
        address1: "560 20th St",
        city: "San Francisco",
        state: "CA",
        postcode: "94107",
        lat: 37.7604,
        lng: -122.3874,
      },
    });
    const orderCode = create.body.data?.createCart.code;

    if (!orderCode) {
      throw new Error("no order code");
    }

    const add = await client.addProductToOrder({
      orderCode,
      productId: INSOMNIA_B9G3F_PRODUCT_ID,
      quantity: 1,
    });

    expect(add.body.errors).toBeUndefined();

    const order = await client.getOrder(orderCode);
    expect(order.body.data?.order.total).toBeGreaterThan(0);
  }, 25_000);
});
