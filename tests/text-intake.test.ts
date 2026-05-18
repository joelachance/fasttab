import { describe, expect, test } from "bun:test";

import {
  extractPreferenceFacts,
  formatPreferenceConfirmation,
  handleFoodrunTextMessage,
  type FoodrunTextStore,
} from "../src/foodrun/text-intake";

function createFakeStore(
  state = "collecting_preferences",
  sessionOverrides: Record<string, unknown> = {},
): {
  store: FoodrunTextStore;
  calls: Array<{ method: string; input: unknown }>;
} {
  const calls: Array<{ method: string; input: unknown }> = [];
  let currentSession: Awaited<ReturnType<FoodrunTextStore["createOrderSession"]>> | null = null;

  return {
    calls,
    store: {
      createOrderSession: async (input) => {
        calls.push({ method: "createOrderSession", input });
        currentSession = {
          roomId: input.roomId,
          state,
          initiatorPhoneNumber: input.initiatorPhoneNumber,
          confirmedPreferences: {},
          supermemoryContext: [],
          stripePaymentLinks: [],
          createdAt: new Date("2026-05-17T18:00:00.000Z"),
          updatedAt: new Date("2026-05-17T18:00:00.000Z"),
          ...sessionOverrides,
        };

        return currentSession;
      },
      getOrderSession: async (roomId) => {
        calls.push({ method: "getOrderSession", input: roomId });
        return currentSession?.roomId === roomId ? currentSession : null;
      },
      upsertParticipant: async (input) => {
        calls.push({ method: "upsertParticipant", input });
        return {} as never;
      },
      appendEvent: async (input) => {
        calls.push({ method: "appendEvent", input });
      },
      updateOrderSession: async (roomId, input) => {
        calls.push({ method: "updateOrderSession", input: { roomId, ...input } });
        if (currentSession?.roomId === roomId) {
          currentSession = { ...currentSession, ...input };
        }
        return {} as never;
      },
      enqueueJob: async (input) => {
        calls.push({ method: "enqueueJob", input });
        return {} as never;
      },
    },
  };
}

describe("text intake", () => {
  test("extracts food preferences and location from freeform text", () => {
    expect(
      extractPreferenceFacts("Thai food near Mission. I'm vegetarian and allergic to peanuts, around $20/person."),
    ).toEqual({
      cuisines: ["Thai"],
      location: "Mission",
      dietary: ["vegetarian"],
      allergies: ["peanuts"],
      budgetPerPersonCents: 2000,
    });
  });

  test("extracts cookie requests and street addresses", () => {
    expect(
      extractPreferenceFacts("I want Insomnia Cookies delivery to 506 20th St, San Francisco, CA 94107"),
    ).toEqual({
      cuisines: ["Insomnia Cookies", "Cookies"],
      location: "506 20th St, San Francisco, CA 94107",
      pickupOrDelivery: "delivery",
    });
  });

  test("asks for a delivery area in the confirmation reply when location is missing", () => {
    expect(formatPreferenceConfirmation({ cuisines: ["Insomnia Cookies"] })).toContain(
      "Send a delivery address",
    );
  });

  test("formats the FastTab confirmation reply", () => {
    expect(
      formatPreferenceConfirmation({
        cuisines: ["Thai"],
        location: "Mission",
        dietary: ["vegetarian"],
        allergies: ["peanuts"],
      }),
    ).toBe(
      [
        "Hi, this is your FastTab agent. I have:",
        "- Thai food",
        "- near Mission",
        "- vegetarian",
        "- no peanuts",
        "",
        "Reply yes to search restaurants, or send changes.",
      ].join("\n"),
    );
  });

  test("persists inbound text state and remembers extracted facts", async () => {
    const { store, calls } = createFakeStore();
    const remembered: unknown[] = [];

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        agentNumberId: "num_123",
        body: "Thai near Mission, vegetarian, no peanuts",
        messageId: "msg_123",
        channel: "imessage",
      },
      {
        store,
        memory: {
          rememberPreference: async (input) => {
            remembered.push(input);
          },
          searchPreferences: async () => ({ memories: [] }),
        },
      },
    );

    expect(result.state).toBe("confirming_preferences");
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
    ]);
    expect(calls[4]?.input).toMatchObject({
      roomId: "conv_123",
      state: "confirming_preferences",
      confirmedPreferences: {
        cuisines: ["Thai"],
        location: "Mission",
        dietary: ["vegetarian"],
        allergies: ["peanuts"],
      },
    });
    expect(remembered).toEqual([
      { phoneNumber: "+15551234567", content: "Thai food", roomId: "conv_123" },
      { phoneNumber: "+15551234567", content: "near Mission", roomId: "conv_123" },
      { phoneNumber: "+15551234567", content: "vegetarian", roomId: "conv_123" },
      { phoneNumber: "+15551234567", content: "no peanuts", roomId: "conv_123" },
    ]);
  });

  test("asks for a delivery area before searching when location is missing", async () => {
    const { store, calls } = createFakeStore("confirming_preferences", {
      confirmedPreferences: { cuisines: ["Insomnia Cookies"] },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "yes",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result.state).toBe("confirming_preferences");
    expect(result.reply).toContain("delivery address");
    expect(calls.map((call) => call.method)).not.toContain("enqueueJob");
  });

  test("enqueues restaurant search when the user confirms", async () => {
    const { store, calls } = createFakeStore("confirming_preferences", {
      confirmedPreferences: {
        cuisines: ["Thai"],
        location: "Mission, San Francisco",
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "yes",
        channel: "sms",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "searching_restaurants",
      reply: "Status: searching restaurants. I'll text you when I find a match and start the cart.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[5]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "restaurant_search",
      payload: {
        requestedBy: "+15551234567",
        agentId: "agent_123",
        channel: "sms",
      },
    });
  });

  test("does not enqueue duplicate work while a browser job is active", async () => {
    const { store, calls } = createFakeStore("building_cart");

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "yes",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "building_cart",
      reply: "Status: still working. I'll text you when this FastTab step finishes or needs input.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
    ]);
  });

  test("accepts confirm order when a cart exists but state drifted", async () => {
    const { store, calls } = createFakeStore("confirming_preferences", {
      cart: {
        restaurantName: "Sense of Thai",
        items: [{ name: "Green curry with tofu", quantity: 1 }],
        screenshots: [],
        status: "draft",
        blockers: [],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "confirm order",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "issuing_card",
      reply: "Status: preparing checkout. Test mode will not place a real order.",
    });
    expect(calls.map((call) => call.method)).toContain("enqueueJob");
  });

  test("loads supermemory context into preferences on first message", async () => {
    const { store, calls } = createFakeStore();
    const searched: unknown[] = [];

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "Thai near Mission, vegetarian",
        channel: "sms",
      },
      {
        store,
        memory: {
          rememberPreference: async () => ({}),
          searchPreferences: async (input) => {
            searched.push(input);
            return { memories: [{ content: "usually orders vegan" }] };
          },
        },
      },
    );

    expect(searched[0]).toMatchObject({
      phoneNumber: "+15551234567",
      query: "Thai vegetarian Mission",
    });
    expect(result.extracted.notes?.join(" ")).toContain("usually orders vegan");
    expect(
      calls.some(
        (call) =>
          call.method === "appendEvent" &&
          (call.input as { eventType?: string }).eventType === "supermemory_context_loaded",
      ),
    ).toBe(true);
  });

  test("confirm order uses demo checkout copy after payment approval", async () => {
    const { store } = createFakeStore("confirming_cart", {
      cart: {
        restaurantName: "Mission Thai",
        items: [{ name: "Pad Thai", quantity: 1 }],
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "confirm order",
        channel: "imessage",
      },
      { store, memory: null, env: { FOODRUN_DEMO_MODE: "true", FOODRUN_CHECKOUT_MODE: "dry_run" } },
    );

    expect(result.reply).toContain("demo checkout");
    expect(result.reply).toContain("payment approved");
  });

  test("confirm order mentions browser placement in live checkout mode", async () => {
    const { store } = createFakeStore("confirming_cart", {
      cart: {
        restaurantName: "Insomnia Cookies",
        items: [{ name: "Classic Chocolate Chunk", quantity: 1 }],
        screenshots: [],
        status: "draft",
        blockers: [],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "confirm order",
        channel: "imessage",
      },
      { store, memory: null, env: { FOODRUN_CHECKOUT_MODE: "live" } },
    );

    expect(result.reply).toContain("place the order on the restaurant site");
  });

  test("requires explicit order confirmation once the cart is ready", async () => {
    const { store, calls } = createFakeStore("confirming_cart");

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "yes",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "confirming_cart",
      reply: "Reply 'confirm order' to continue, or send changes to the cart.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
    ]);
  });

  test("rejected cart option clears the restaurant and starts another search", async () => {
    const { store, calls } = createFakeStore("confirming_cart", {
      confirmedPreferences: {
        cuisines: ["Thai"],
        notes: ["vegetarian"],
      },
      selectedRestaurant: {
        name: "Thai Basil Cart",
      },
      cart: {
        restaurantName: "Thai Basil Cart",
        items: [{ name: "Pad Thai", quantity: 1 }],
        screenshots: [],
        status: "checkout_ready",
        blockers: [],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "no",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "searching_restaurants",
      reply:
        "Status: trying another option. I'll check the next restaurant is open and can add to cart, then send it for approval.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[4]?.input).toMatchObject({
      roomId: "conv_123",
      state: "searching_restaurants",
      selectedRestaurant: null,
      cart: null,
      browserUseSessionId: null,
      browserUseLiveUrl: null,
      confirmedPreferences: {
        cuisines: ["Thai"],
        notes: ["vegetarian", "Previous option rejected: Thai Basil Cart. Try a different restaurant."],
      },
    });
    expect(calls[5]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "restaurant_search",
    });
  });

  test("retries cart building from the selected restaurant state", async () => {
    const { store, calls } = createFakeStore("selecting_restaurant", {
      selectedRestaurant: {
        name: "Thai Basil Cart",
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "retry cart",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "building_cart",
      reply:
        "Status: retrying cart. I'll text you when the draft cart is ready, or if checkout blocks me.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[5]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "cart_build",
    });
  });

  test("retries cart building when a restaurant is selected even if state drifted", async () => {
    const { store, calls } = createFakeStore("confirming_preferences", {
      selectedRestaurant: {
        name: "Thai Basil Cart",
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "Retry cart",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "building_cart",
      reply:
        "Status: retrying cart. I'll text you when the draft cart is ready, or if checkout blocks me.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[5]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "cart_build",
    });
  });

  test("retries cart building when the existing cart is blocked", async () => {
    const { store, calls } = createFakeStore("confirming_cart", {
      selectedRestaurant: {
        name: "Thai Basil Cart",
      },
      cart: {
        restaurantName: "Thai Basil Cart",
        items: [],
        screenshots: [],
        status: "blocked",
        blockers: ["Task stopped before checkout"],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "Retry cart",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "building_cart",
      reply:
        "Status: retrying cart. I'll text you when the draft cart is ready, or if checkout blocks me.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[5]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "cart_build",
    });
  });

  test("does not confirm a blocked cart", async () => {
    const { store, calls } = createFakeStore("confirming_cart", {
      cart: {
        restaurantName: "Thai Basil Cart",
        items: [],
        screenshots: [],
        status: "blocked",
        blockers: ["Task stopped before checkout"],
      },
    });

    const result = await handleFoodrunTextMessage(
      {
        roomId: "conv_123",
        agentId: "agent_123",
        fromNumber: "+15551234567",
        body: "confirm order",
        channel: "imessage",
      },
      { store, memory: null },
    );

    expect(result).toMatchObject({
      state: "confirming_cart",
      reply:
        "Status: cart blocked. I can't confirm the order until the cart is rebuilt. Reply 'retry cart' or send a cart change.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "getOrderSession",
      "upsertParticipant",
      "appendEvent",
    ]);
  });
});
