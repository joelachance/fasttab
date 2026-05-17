import { describe, expect, test } from "bun:test";

import { SupermemoryModule, type SupermemoryClientLike } from "../src/modules/supermemory";

type RecordedCall = {
  method: "add" | "search.memories";
  body: unknown;
};

function createFakeClient(calls: RecordedCall[]): SupermemoryClientLike {
  return {
    add: async (body) => {
      calls.push({ method: "add", body });
      return { ok: true };
    },
    search: {
      memories: async (body) => {
        calls.push({ method: "search.memories", body });
        return { memories: [] };
      },
    },
  };
}

describe("SupermemoryModule", () => {
  test("remembers a phone-scoped food preference", async () => {
    const calls: RecordedCall[] = [];
    const module = new SupermemoryModule(
      { SUPERMEMORY_API_KEY: "unused" },
      createFakeClient(calls),
    );

    await module.rememberPreference({
      phoneNumber: "+1 (555) 123-4567",
      content: "Joe is vegetarian",
      roomId: "room_123",
    });

    expect(calls[0]).toMatchObject({
      method: "add",
      body: {
        content: "Joe is vegetarian",
        containerTag: "phone_15551234567",
        metadata: {
          source: "foodrun",
          phoneNumber: "+1 (555) 123-4567",
          roomId: "room_123",
        },
      },
    });
  });

  test("searches phone-scoped food preferences", async () => {
    const calls: RecordedCall[] = [];
    const module = new SupermemoryModule(
      { SUPERMEMORY_API_KEY: "unused" },
      createFakeClient(calls),
    );

    await module.searchPreferences({
      phoneNumber: "+15551234567",
      query: "food preferences",
    });

    expect(calls).toEqual([
      {
        method: "search.memories",
        body: {
          q: "food preferences",
          containerTag: "phone_15551234567",
          searchMode: "hybrid",
          limit: 5,
        },
      },
    ]);
  });
});
