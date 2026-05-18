import { describe, expect, test } from "bun:test";

import type { MessageResponse, SessionResult } from "browser-use-sdk/v3";

import {
  BrowserPromptOutputSchema,
  BrowserUseModule,
  buildCheckoutPlacementPrompt,
  buildCartWithOrderingProviders,
  buildMarketplaceCartInParallel,
  buildOfficialDirectCartWithFallback,
  buildRestaurantAvailabilityPrompt,
  buildCartPrompt,
  buildRestaurantSearchPrompt,
  parseBrowserUseJson,
  runCartTaskWithBlockedFallback,
} from "../src/modules/browser-use";
import type { OrderCriteria, RestaurantOption } from "../src/types";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "Hayes Valley, San Francisco", placeName: "Hayes Valley" },
  cuisine: "Thai",
  budgetPerPerson: { currency: "usd", cents: 2500 },
  pickupOrDelivery: "pickup",
  participantCount: 4,
  preferences: ["vegetarian options", "family style"],
  allergies: ["peanuts"],
};

const restaurant: RestaurantOption = {
  name: "Basil Cafe Thai Cuisine",
  orderingUrl: "https://example.com/order",
  reason: "Close and fits Thai request",
  dietaryFit: ["vegetarian options"],
};

describe("Browser Use module", () => {
  test("buildRestaurantSearchPrompt contains required criteria and safety rails", () => {
    const prompt = buildRestaurantSearchPrompt(criteria);

    expect(prompt).toContain("structured JSON");
    expect(prompt).toContain("Do not place an order");
    expect(prompt).toContain("Prefer Toast first");
    expect(prompt).toContain("Grubhub and DoorDash are acceptable");
    expect(prompt).toContain("First run an availability scan");
    expect(prompt).toContain("currently accepting online orders");
    expect(prompt).toContain("Check at least 3 direct-ordering candidates");
    expect(prompt).toContain("return the best currently accepting nearby alternative cuisine");
    expect(prompt).toContain("Return the most cartable option first");
    expect(prompt).toContain("Hayes Valley");
    expect(prompt).toContain("Thai");
    expect(prompt).toContain("$25.00 per person");
    expect(prompt).toContain("peanuts");
  });

  test("buildCartPrompt contains cart task, payment stop, and ordering URL", () => {
    const prompt = buildCartPrompt(criteria, restaurant);

    expect(prompt).toContain("Build a takeout cart");
    expect(prompt).toContain("stop before payment");
    expect(prompt).toContain("https://example.com/order");
    expect(prompt).toContain("Return raw JSON only");
    expect(prompt).toContain("Stay on Basil Cafe Thai Cuisine");
    expect(prompt).toContain("Toast Tab");
    expect(prompt).toContain("Immediately check whether this restaurant is open");
    expect(prompt).toContain("at least one item can be added to a cart");
    expect(prompt).toContain("Spend up to about 60 seconds");
    expect(prompt).toContain('"status": "blocked"');
    expect(prompt).toContain("internal draft cart from visible menu items is acceptable");
    expect(prompt).toContain('"status": "draft"');
    expect(prompt).toContain("Do not answer with prose");
    expect(prompt).toContain("Task stopped");
  });

  test("buildRestaurantAvailabilityPrompt verifies API-shortlisted candidates", () => {
    const prompt = buildRestaurantAvailabilityPrompt(criteria, [
      {
        name: "Mission Thai",
        orderingUrl: "https://toast.example.com/mission-thai",
        address: "123 Mission St",
        reason: "Open now per Google Places",
        dietaryFit: [],
      },
    ]);

    expect(prompt).toContain("API-shortlisted restaurant candidates");
    expect(prompt).toContain("immediately check current hours/open status");
    expect(prompt).toContain("Spend no more than about 30 seconds");
    expect(prompt).toContain("Mission Thai");
    expect(prompt).toContain("https://toast.example.com/mission-thai");
  });

  test("parseBrowserUseJson parses fenced JSON string into BrowserPromptOutputSchema", () => {
    const parsed = parseBrowserUseJson(
      '```json\n{"summary":"Done","restaurants":[]}\n```',
      BrowserPromptOutputSchema,
    );

    expect(parsed.summary).toBe("Done");
  });

  test("BrowserPromptOutputSchema defaults restaurants, blockers, and nextSteps", () => {
    const parsed = BrowserPromptOutputSchema.parse({ summary: "Done" });

    expect(parsed.restaurants).toEqual([]);
    expect(parsed.blockers).toEqual([]);
    expect(parsed.nextSteps).toEqual([]);
  });

  test("runTask mock client passes task and options and returns session output", async () => {
    const calls: Array<{ task: string; options: Record<string, unknown> }> = [];
    const client = {
      run: (task: string, options: Record<string, unknown>) => {
        calls.push({ task, options });
        return Promise.resolve({
          id: "session_123",
          output: { summary: "Done" },
          liveUrl: "https://live.example.com",
        } as SessionResult<{ summary: string }>);
      },
    };
    const module = new BrowserUseModule(
      { BROWSER_USE_API_KEY: "unused", BROWSER_USE_MODEL: "bu-max" },
      client,
    );

    const result = await module.runTask("test task", BrowserPromptOutputSchema, {
      keepAlive: true,
      maxCostUsd: 1,
    });

    expect(calls[0]?.task).toBe("test task");
    expect(calls[0]?.options).toMatchObject({
      model: "bu-max",
      keepAlive: true,
      maxCostUsd: 1,
      schema: BrowserPromptOutputSchema,
    });
    expect(result.sessionId).toBe("session_123");
    expect(result.output.summary).toBe("Done");
  });

  test("runTask consumes async-iterable run and sends messages to onMessage", async () => {
    const messages: string[] = [];
    const run = {
      sessionId: "session_123",
      result: {
        id: "session_123",
        output: { summary: "Done" },
      } as SessionResult<{ summary: string }>,
      async *[Symbol.asyncIterator]() {
        yield {
          id: "msg_123",
          sessionId: "session_123",
          role: "ai",
          data: "{}",
          type: "browser_action",
          summary: "Clicked checkout",
        } as MessageResponse;
      },
    };
    const client = {
      run: () => run,
    };
    const module = new BrowserUseModule({ BROWSER_USE_API_KEY: "unused" }, client);

    await module.runTask("test task", BrowserPromptOutputSchema, {
      onMessage(message) {
        messages.push(message.summary);
      },
    });

    expect(messages).toEqual(["Clicked checkout"]);
  });

  test("buildCartPrompt discovery mode searches alternate direct providers", () => {
    const prompt = buildCartPrompt(criteria, restaurant, { discoverProviders: true });

    expect(prompt).toContain("Search the web for this restaurant's direct ordering page");
    expect(prompt).toContain("Prefer Toast Tab first");
    expect(prompt).toContain("try Grubhub and DoorDash");
  });

  test("buildCartPrompt marketplace mode targets grubhub and doordash", () => {
    const prompt = buildCartPrompt(
      { ...criteria, preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
      { useMarketplace: true },
    );

    expect(prompt).toContain("Grubhub and DoorDash");
    expect(prompt).toContain("Prefer Grubhub first");
  });

  test("buildCartPrompt official insomnia site returns draft within 60s and skips captcha", () => {
    const prompt = buildCartPrompt(
      { ...criteria, preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
    );

    expect(prompt).toContain("Within 60 seconds");
    expect(prompt).toContain("Classic Chocolate Chunk");
    expect(prompt).toContain("reCAPTCHA");
    expect(prompt).toContain("Do not open Grubhub");
  });

  test("buildCheckoutPlacementPrompt includes card, address, and customer phone", () => {
    const prompt = buildCheckoutPlacementPrompt({
      criteria: { ...criteria, deliveryPhone: "+15551234567" },
      restaurant,
      checkoutUrl: "https://example.com/cart",
      card: {
        cardNumber: "4111111111111111",
        cvc: "123",
        expiration: "12/29",
        cardholderName: "FastTab Agent",
      },
      cart: {
        restaurantName: restaurant.name,
        checkoutUrl: "https://example.com/cart",
        items: [{ name: "Pad Thai", quantity: 2, price: { currency: "usd", cents: 1550 } }],
        estimatedTotal: { currency: "usd", cents: 3100 },
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    });

    expect(prompt).toContain("4111111111111111");
    expect(prompt).toContain("CVC: 123");
    expect(prompt).toContain("Hayes Valley");
    expect(prompt).toContain("+15551234567");
    expect(prompt).toContain("never an AgentPhone");
    expect(prompt).toContain('"status": "placed"');
  });

  test("buildCartPrompt includes customer delivery phone for insomnia checkout", () => {
    const prompt = buildCartPrompt(
      { ...criteria, deliveryPhone: "+15551234567", preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
    );

    expect(prompt).toContain("Delivery phone (customer");
    expect(prompt).toContain("+15551234567");
    expect(prompt).toContain("never an AgentPhone");
  });

  test("buildCartPrompt marketplace grubhub mode scopes to grubhub only", () => {
    const prompt = buildCartPrompt(
      criteria,
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
      { useMarketplace: true, marketplaceProvider: "grubhub" },
    );

    expect(prompt).toContain("grubhub.com only");
    expect(prompt).not.toContain("doordash.com only");
  });

  test("buildMarketplaceCartInParallel runs grubhub and doordash concurrently", async () => {
    const calls: string[] = [];
    const browser = {
      runTask: async (task: string) => {
        calls.push(task);

        const provider =
          task.includes("grubhub.com only") ? "grubhub" : task.includes("doordash.com only") ? "doordash" : "unknown";

        return {
          sessionId: `session_${provider}`,
          output: {
            restaurantName: "Insomnia Cookies",
            items:
              provider === "grubhub" ?
                [{ name: "Classic Cookie", quantity: 6, priceUsd: 24 }]
              : [],
            screenshots: [],
            status: provider === "grubhub" ? "checkout_ready" : "blocked",
            blockers: provider === "grubhub" ? [] : ["DoorDash login required"],
          },
          raw: { id: `session_${provider}`, output: "" },
        };
      },
    };

    const result = await buildMarketplaceCartInParallel(
      browser,
      { ...criteria, preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
      { timeoutMs: 120_000 },
    );

    expect(calls).toHaveLength(2);
    expect(calls.some((task) => task.includes("grubhub.com only"))).toBe(true);
    expect(calls.some((task) => task.includes("doordash.com only"))).toBe(true);
    expect(result.output.status).toBe("checkout_ready");
    expect(result.output.items).toHaveLength(1);
  });

  test("buildCartWithOrderingProviders tries official insomnia site then grubhub only", async () => {
    const calls: string[] = [];
    const browser = {
      runTask: async (task: string) => {
        calls.push(task);

        return {
          sessionId: calls.length === 1 ? "session_direct" : "session_marketplace",
          output: {
            restaurantName: "Insomnia Cookies",
            items:
              calls.length === 1 ?
                []
              : [{ name: "Chocolate Chunk", quantity: 4, priceUsd: 16 }],
            screenshots: [],
            status: calls.length === 1 ? "blocked" : "checkout_ready",
            blockers: calls.length === 1 ? ["Official site requires login before cart"] : [],
          },
          raw: { id: `session_${calls.length}`, output: "" },
        };
      },
    };

    const result = await buildCartWithOrderingProviders(
      browser,
      { ...criteria, preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("insomniacookies.com");
    expect(calls[1]).toContain("grubhub.com only");
    expect(calls[1]).not.toContain("doordash.com only");
    expect(result.output.items).toHaveLength(1);
  });

  test("buildOfficialDirectCartWithFallback does not run provider discovery", async () => {
    const calls: string[] = [];
    const browser = {
      runTask: async (task: string) => {
        calls.push(task);

        return {
          sessionId: `session_${calls.length}`,
          output: {
            restaurantName: "Insomnia Cookies",
            items: [],
            screenshots: [],
            status: "blocked",
            blockers: ["blocked"],
          },
          raw: { id: `session_${calls.length}`, output: "" },
        };
      },
    };

    await buildOfficialDirectCartWithFallback(
      browser,
      { ...criteria, preferences: ["Insomnia Cookies"] },
      {
        name: "Insomnia Cookies",
        orderingUrl: "https://insomniacookies.com/",
        reason: "Cookie delivery",
        dietaryFit: [],
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls.every((task) => !task.includes("Search the web for this restaurant's direct ordering page"))).toBe(
      true,
    );
  });

  test("buildCartWithOrderingProviders retries discovery after blocked provider", async () => {
    const calls: string[] = [];
    const browser = {
      runTask: async (task: string) => {
        calls.push(task);

        if (calls.length === 1) {
          return {
            id: "session_blocked",
            output: {
              restaurantName: restaurant.name,
              items: [],
              screenshots: [],
              status: "blocked",
              blockers: ['Unexpected token "S", "[Session co"... is not valid JSON'],
            },
          };
        }

        return {
          id: "session_ready",
          output: {
            restaurantName: restaurant.name,
            checkoutUrl: "https://www.toasttab.com/basil-cafe/cart",
            items: [{ name: "Pad Thai", quantity: 1, priceUsd: 15.5 }],
            screenshots: [],
            status: "checkout_ready",
            blockers: [],
          },
        };
      },
    };

    const result = await buildCartWithOrderingProviders(browser, criteria, {
      ...restaurant,
      orderingUrl: "https://senseofthaiashburn.blizzfull.com/menu",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("https://senseofthaiashburn.blizzfull.com/menu");
    expect(calls[1]).toContain("Search the web for this restaurant's direct ordering page");
    expect(result.output.status).toBe("checkout_ready");
    expect(result.output.items).toHaveLength(1);
  });

  test("runCartTaskWithBlockedFallback converts stopped prose into blocked cart JSON", async () => {
    const browser = {
      runTask: async () => {
        throw new SyntaxError('Unexpected token "S", "[Session co"... is not valid JSON');
      },
    };

    const result = await runCartTaskWithBlockedFallback(browser, criteria, restaurant, {
      sessionId: "browser_cart_123",
    });

    expect(result).toMatchObject({
      sessionId: "browser_cart_123",
      output: {
        restaurantName: "Basil Cafe Thai Cuisine",
        items: [],
        status: "blocked",
        blockers: ['Unexpected token "S", "[Session co"... is not valid JSON'],
      },
    });
  });

  test("parseBrowserUseJson surfaces session errors clearly", () => {
    expect(() =>
      parseBrowserUseJson("[Session connection lost before cart JSON]", BrowserPromptOutputSchema),
    ).toThrow("Browser Use session did not return cart JSON");
  });
});
