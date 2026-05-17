import { describe, expect, test } from "bun:test";

import type { MessageResponse, SessionResult } from "browser-use-sdk/v3";

import {
  BrowserPromptOutputSchema,
  BrowserUseModule,
  buildCartPrompt,
  buildRestaurantSearchPrompt,
  parseBrowserUseJson,
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
    expect(prompt).toContain('"status": "blocked"');
    expect(prompt).toContain("Do not answer with prose");
    expect(prompt).toContain("Task stopped");
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
});
