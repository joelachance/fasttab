import { describe, expect, test } from "bun:test";

import {
  extractPreferenceFacts,
  formatPreferenceConfirmation,
  handleFoodrunTextMessage,
  type FoodrunTextStore,
} from "../src/foodrun/text-intake";

function createFakeStore(): {
  store: FoodrunTextStore;
  calls: Array<{ method: string; input: unknown }>;
} {
  const calls: Array<{ method: string; input: unknown }> = [];

  return {
    calls,
    store: {
      createOrderSession: async (input) => {
        calls.push({ method: "createOrderSession", input });
        return {
          roomId: input.roomId,
          state: input.state ?? "collecting_preferences",
          initiatorPhoneNumber: input.initiatorPhoneNumber,
          confirmedPreferences: {},
          supermemoryContext: [],
          stripePaymentLinks: [],
          createdAt: new Date("2026-05-17T18:00:00.000Z"),
          updatedAt: new Date("2026-05-17T18:00:00.000Z"),
        };
      },
      getOrderSession: async () => {
        calls.push({ method: "getOrderSession", input: undefined });
        return null;
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
        },
      },
    );

    expect(result.state).toBe("confirming_preferences");
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
    ]);
    expect(calls[3]?.input).toMatchObject({
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

  test("enqueues restaurant search when the user confirms", async () => {
    const { store, calls } = createFakeStore();

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
      reply: "Great. I'll search for restaurants that match your preferences.",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createOrderSession",
      "upsertParticipant",
      "appendEvent",
      "updateOrderSession",
      "enqueueJob",
    ]);
    expect(calls[4]?.input).toMatchObject({
      roomId: "conv_123",
      kind: "restaurant_search",
      payload: {
        requestedBy: "+15551234567",
        agentId: "agent_123",
        channel: "sms",
      },
    });
  });
});
