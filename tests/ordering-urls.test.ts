import { describe, expect, test } from "bun:test";

import {
  buildOrderingUrlAttempts,
  detectOrderingProvider,
  prefersMarketplaceOrdering,
  shouldDiscoverOrderingProviders,
  shouldTryMarketplaceOrdering,
} from "../src/modules/browser-use/ordering-urls";
import type { OrderCriteria } from "../src/types";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "Mission, San Francisco", placeName: "Mission" },
  cuisine: "Cookies",
  pickupOrDelivery: "delivery",
  participantCount: 2,
  preferences: ["Insomnia Cookies"],
  allergies: [],
};

describe("ordering urls", () => {
  test("detects toast and marketplace providers", () => {
    expect(detectOrderingProvider("https://www.toasttab.com/sense-of-thai/v2")).toBe("toast");
    expect(detectOrderingProvider("https://www.doordash.com/store/sense-of-thai")).toBe(
      "marketplace",
    );
    expect(detectOrderingProvider("https://senseofthaiashburn.blizzfull.com/menu")).toBe(
      "blizzfull",
    );
  });

  test("prioritizes toast before blizzfull urls", () => {
    expect(
      buildOrderingUrlAttempts({
        name: "Sense of Thai",
        url: "https://senseofthaiashburn.blizzfull.com/menu",
        orderingUrl: "https://www.toasttab.com/sense-of-thai/v2",
        reason: "test",
        dietaryFit: [],
      }),
    ).toEqual([
      "https://www.toasttab.com/sense-of-thai/v2",
      "https://senseofthaiashburn.blizzfull.com/menu",
    ]);
  });

  test("detects insomnia cookies as marketplace-first", () => {
    const restaurant = {
      name: "Insomnia Cookies",
      orderingUrl: "https://insomniacookies.com/",
      reason: "Cookie delivery",
      dietaryFit: [],
    };

    expect(prefersMarketplaceOrdering(criteria, restaurant)).toBe(true);
    expect(shouldTryMarketplaceOrdering(criteria, restaurant)).toBe(true);
  });

  test("requests provider discovery for blizzfull-only restaurants", () => {
    expect(
      shouldDiscoverOrderingProviders({
        name: "Sense of Thai Ashburn",
        orderingUrl: "https://senseofthaiashburn.blizzfull.com/menu",
        reason: "test",
        dietaryFit: [],
      }),
    ).toBe(true);
  });
});
