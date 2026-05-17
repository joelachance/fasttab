import { describe, expect, test } from "bun:test";

import {
  processFoodrunJobs,
  type FoodrunBrowserUse,
  type FoodrunJobNotifier,
  type FoodrunJobStore,
  type FoodrunStripe,
} from "../src/foodrun/job-worker";
import type { FoodrunJob, FoodrunOrderSession, FoodrunParticipant } from "../src/foodrun/order-state";

const baseSession: FoodrunOrderSession = {
  roomId: "room_123",
  state: "searching_restaurants",
  initiatorPhoneNumber: "+15551234567",
  confirmedPreferences: {
    cuisines: ["Thai"],
    location: "Mission",
    dietary: ["vegetarian"],
    allergies: ["peanuts"],
    budgetPerPersonCents: 2000,
  },
  supermemoryContext: [],
  stripePaymentLinks: [],
  createdAt: new Date("2026-05-17T18:00:00.000Z"),
  updatedAt: new Date("2026-05-17T18:00:00.000Z"),
};

const participant: FoodrunParticipant = {
  participantId: "participant_123",
  roomId: "room_123",
  phoneNumber: "+15551234567",
  role: "initiator",
  preferences: {},
  joinedAt: new Date("2026-05-17T18:00:00.000Z"),
};

function job(overrides?: Partial<FoodrunJob>): FoodrunJob {
  return {
    jobId: "job_123",
    roomId: "room_123",
    kind: "restaurant_search",
    status: "running",
    attempts: 1,
    runAfter: new Date("2026-05-17T18:00:00.000Z"),
    payload: {
      requestedBy: "+15551234567",
      agentId: "agent_123",
      agentNumberId: "num_123",
    },
    ...overrides,
  };
}

function createStore(input: {
  jobs: FoodrunJob[];
  session?: FoodrunOrderSession;
  participants?: FoodrunParticipant[];
}): { store: FoodrunJobStore; calls: Array<{ method: string; input: unknown }> } {
  const calls: Array<{ method: string; input: unknown }> = [];

  return {
    calls,
    store: {
      claimNextJob: async () => input.jobs.shift() ?? null,
      completeJob: async (jobId) => {
        calls.push({ method: "completeJob", input: jobId });
      },
      failJob: async (jobId, error) => {
        calls.push({ method: "failJob", input: { jobId, error } });
      },
      getOrderSession: async () => input.session ?? baseSession,
      listParticipants: async () => input.participants ?? [participant],
      updateOrderSession: async (roomId, update) => {
        calls.push({ method: "updateOrderSession", input: { roomId, ...update } });
        return { ...(input.session ?? baseSession), ...update };
      },
      appendEvent: async (event) => {
        calls.push({ method: "appendEvent", input: event });
      },
      enqueueJob: async (queued) => {
        calls.push({ method: "enqueueJob", input: queued });
        return job({ kind: queued.kind, payload: queued.payload ?? {} });
      },
    },
  };
}

describe("processFoodrunJobs", () => {
  test("runs restaurant search and enqueues cart build", async () => {
    const { store, calls } = createStore({ jobs: [job()] });
    const sent: unknown[] = [];
    const browser: FoodrunBrowserUse = {
      searchRestaurants: async (criteria) => {
        expect(criteria).toMatchObject({
          roomId: "room_123",
          cuisine: "Thai",
          location: { raw: "Mission" },
          allergies: ["peanuts"],
        });
        return {
          sessionId: "browser_search_123",
          output: {
            restaurants: [
              {
                name: "Mission Thai",
                orderingUrl: "https://example.com/order",
                reason: "Close",
                dietaryFit: ["vegetarian"],
              },
            ],
          },
          raw: {} as never,
        };
      },
      buildCart: async () => {
        throw new Error("buildCart should run in the cart_build job");
      },
    };
    const notifier: FoodrunJobNotifier = {
      sendText: async (input) => {
        sent.push(input);
      },
    };

    await expect(
      processFoodrunJobs(1, { store, browser, notifier }),
    ).resolves.toMatchObject({ processed: 1 });
    expect(calls[0]).toMatchObject({
      method: "updateOrderSession",
      input: {
        roomId: "room_123",
        state: "building_cart",
        browserUseSessionId: "browser_search_123",
      },
    });
    expect(calls.find((call) => call.method === "enqueueJob")?.input).toMatchObject({
      roomId: "room_123",
      kind: "cart_build",
    });
    expect(sent[0]).toMatchObject({
      body: "I found Mission Thai. I'm building a draft cart now.",
    });
  });

  test("builds a cart and notifies the requester", async () => {
    const session: FoodrunOrderSession = {
      ...baseSession,
      state: "building_cart",
      selectedRestaurant: {
        name: "Mission Thai",
        orderingUrl: "https://example.com/order",
        reason: "Close",
        dietaryFit: ["vegetarian"],
      },
      browserUseSessionId: "browser_search_123",
    };
    const { store, calls } = createStore({
      jobs: [job({ kind: "cart_build" })],
      session,
    });
    const sent: unknown[] = [];
    const browser: FoodrunBrowserUse = {
      searchRestaurants: async () => {
        throw new Error("searchRestaurants should not run in the cart_build job");
      },
      buildCart: async (_criteria, _restaurant, options) => {
        expect(options?.sessionId).toBe("browser_search_123");

        return {
        sessionId: "browser_cart_123",
        liveUrl: "https://browser.example.com/live",
        output: {
          restaurantName: "Mission Thai",
          items: [{ name: "Pad Thai", quantity: 2 }],
          estimatedTotal: { currency: "usd", cents: 4200 },
          screenshots: [],
          status: "checkout_ready",
          blockers: [],
        },
        raw: {} as never,
        };
      },
    };
    const notifier: FoodrunJobNotifier = {
      sendText: async (input) => {
        sent.push(input);
      },
    };

    await expect(
      processFoodrunJobs(1, { store, browser, notifier }),
    ).resolves.toMatchObject({ processed: 1 });
    expect(calls[0]).toMatchObject({
      method: "updateOrderSession",
      input: {
        roomId: "room_123",
        state: "confirming_cart",
        browserUseSessionId: "browser_cart_123",
      },
    });
    expect(sent[0]).toMatchObject({
      agentId: "agent_123",
      toNumber: "+15551234567",
      numberId: "num_123",
    });
  });

  test("skips stale restaurant search when a restaurant is already selected", async () => {
    const session: FoodrunOrderSession = {
      ...baseSession,
      state: "building_cart",
      selectedRestaurant: {
        name: "Mission Thai",
        orderingUrl: "https://example.com/order",
        reason: "Close",
        dietaryFit: [],
      },
    };
    const { store, calls } = createStore({
      jobs: [job({ kind: "restaurant_search" })],
      session,
    });
    const browser: FoodrunBrowserUse = {
      searchRestaurants: async () => {
        throw new Error("stale search should not run Browser Use again");
      },
      buildCart: async () => {
        throw new Error("stale search should only enqueue cart_build");
      },
    };

    await processFoodrunJobs(1, { store, browser, notifier: null });

    expect(calls.find((call) => call.method === "enqueueJob")?.input).toMatchObject({
      roomId: "room_123",
      kind: "cart_build",
    });
    expect(calls.find((call) => call.method === "appendEvent")?.input).toMatchObject({
      eventType: "stale_restaurant_search_skipped",
    });
  });

  test("edits a cart from stored cart context and Browser Use session", async () => {
    const session: FoodrunOrderSession = {
      ...baseSession,
      state: "editing_cart",
      selectedRestaurant: {
        name: "Mission Thai",
        orderingUrl: "https://example.com/order",
        reason: "Close",
        dietaryFit: ["vegetarian"],
      },
      browserUseSessionId: "browser_cart_123",
      cart: {
        restaurantName: "Mission Thai",
        items: [
          {
            name: "Pad Thai",
            quantity: 2,
            price: { currency: "usd", cents: 1600 },
            notes: "no peanuts",
          },
        ],
        estimatedTotal: { currency: "usd", cents: 4200 },
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    };
    const { store, calls } = createStore({
      jobs: [job({ kind: "cart_edit", payload: { ...job().payload, editText: "swap one Pad Thai for green curry" } })],
      session,
    });
    const browser: FoodrunBrowserUse = {
      searchRestaurants: async () => {
        throw new Error("searchRestaurants should not run in the cart_edit job");
      },
      buildCart: async (criteria, _restaurant, options) => {
        expect(options?.sessionId).toBe("browser_cart_123");
        expect(criteria.preferences).toContain(
          "Current cart before changes: Mission Thai, items: 2x Pad Thai $16.00 (no peanuts), total: $42.00",
        );
        expect(criteria.preferences).toContain(
          "Cart change requested by text: swap one Pad Thai for green curry",
        );

        return {
          sessionId: "browser_cart_456",
          output: {
            restaurantName: "Mission Thai",
            items: [
              { name: "Pad Thai", quantity: 1 },
              { name: "Green Curry", quantity: 1 },
            ],
            estimatedTotal: { currency: "usd", cents: 4300 },
            screenshots: [],
            status: "checkout_ready",
            blockers: [],
          },
          raw: {} as never,
        };
      },
    };

    await processFoodrunJobs(1, { store, browser, notifier: null });

    expect(calls.find((call) => call.method === "updateOrderSession")?.input).toMatchObject({
      state: "confirming_cart",
      browserUseSessionId: "browser_cart_456",
      cart: {
        items: [
          { name: "Pad Thai", quantity: 1 },
          { name: "Green Curry", quantity: 1 },
        ],
      },
    });
  });

  test("dry-run checkout enqueues post-order split without placing an order", async () => {
    const session: FoodrunOrderSession = {
      ...baseSession,
      state: "issuing_card",
      selectedRestaurant: {
        name: "Mission Thai",
        orderingUrl: "https://example.com/order",
        reason: "Close",
        dietaryFit: [],
      },
      cart: {
        restaurantName: "Mission Thai",
        items: [{ name: "Pad Thai", quantity: 2 }],
        estimatedTotal: { currency: "usd", cents: 4200 },
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    };
    const { store, calls } = createStore({
      jobs: [job({ kind: "checkout_payment" })],
      session,
    });

    await processFoodrunJobs(1, { store, notifier: null, env: { FOODRUN_CHECKOUT_MODE: "dry_run" } });

    expect(calls.map((call) => call.method)).toContain("enqueueJob");
    expect(calls.find((call) => call.method === "updateOrderSession")?.input).toMatchObject({
      state: "splitting_bill",
      orderConfirmation: {
        restaurantName: "Mission Thai",
        finalTotalCents: 4200,
      },
    });
  });

  test("post-order split creates Stripe payment links and texts participants", async () => {
    const session: FoodrunOrderSession = {
      ...baseSession,
      orderConfirmation: {
        restaurantName: "Mission Thai",
        finalTotalCents: 4200,
      },
    };
    const { store, calls } = createStore({
      jobs: [job({ kind: "post_order_split" })],
      session,
    });
    const sent: unknown[] = [];
    const stripe: FoodrunStripe = {
      createPaymentLinks: async (splits) => {
        expect(splits).toEqual([
          {
            participantId: "participant_123",
            phoneNumber: "+15551234567",
            amount: { currency: "usd", cents: 4200 },
            description: "FastTab split - Mission Thai",
          },
        ]);
        return [
          {
            participantId: "participant_123",
            phoneNumber: "+15551234567",
            amountCents: 4200,
            url: "https://buy.stripe.com/test_123",
          },
        ];
      },
    };
    const notifier: FoodrunJobNotifier = {
      sendText: async (input) => {
        sent.push(input);
      },
    };

    await processFoodrunJobs(1, { store, stripe, notifier });

    expect(calls.find((call) => call.method === "updateOrderSession")?.input).toMatchObject({
      state: "complete",
      stripePaymentLinks: [
        {
          url: "https://buy.stripe.com/test_123",
        },
      ],
    });
    expect(sent[0]).toMatchObject({
      body: "FastTab split: your share is $42.00.\nPay here: https://buy.stripe.com/test_123",
    });
  });
});
