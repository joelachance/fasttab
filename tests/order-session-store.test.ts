import { describe, expect, test } from "bun:test";

import { OrderSessionStore } from "../src/foodrun/order-session-store";
import type { FoodrunSqlClient } from "../src/modules/postgres";

type QueryCall = {
  query: string;
  params?: unknown[];
};

function createFakeSql(rows: unknown[][]): { sql: FoodrunSqlClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  return {
    calls,
    sql: {
      query: async (query, params) => {
        calls.push({ query, params });
        return rows.shift() ?? [];
      },
    },
  };
}

function sessionRow(overrides?: Record<string, unknown>) {
  return {
    room_id: "room_123",
    state: "collecting_preferences",
    initiator_phone_number: "+15551234567",
    agent_phone_number: "+15557654321",
    original_prompt: "thai for four",
    confirmed_preferences: { dietary: ["vegetarian"] },
    supermemory_context: [],
    selected_restaurant: null,
    cart: null,
    sponge_card: null,
    order_confirmation: null,
    stripe_payment_links: [],
    browser_use_session_id: null,
    browser_use_live_url: null,
    idempotency_key: "webhook_123",
    created_at: "2026-05-17T18:00:00.000Z",
    updated_at: "2026-05-17T18:00:00.000Z",
    ...overrides,
  };
}

describe("OrderSessionStore", () => {
  test("creates an order session with the initial conversation state", async () => {
    const { sql, calls } = createFakeSql([[sessionRow()]]);
    const store = new OrderSessionStore(sql);

    const session = await store.createOrderSession({
      roomId: "room_123",
      initiatorPhoneNumber: "+15551234567",
      agentPhoneNumber: "+15557654321",
      originalPrompt: "thai for four",
      idempotencyKey: "webhook_123",
    });

    expect(session).toMatchObject({
      roomId: "room_123",
      state: "collecting_preferences",
      initiatorPhoneNumber: "+15551234567",
      confirmedPreferences: { dietary: ["vegetarian"] },
    });
    expect(calls[0]?.params).toEqual([
      "room_123",
      "collecting_preferences",
      "+15551234567",
      "+15557654321",
      "thai for four",
      "webhook_123",
    ]);
  });

  test("updates structured order state as jsonb", async () => {
    const { sql, calls } = createFakeSql([
      [
        sessionRow({
          state: "confirming_preferences",
          confirmed_preferences: { allergies: ["peanuts"] },
        }),
      ],
    ]);
    const store = new OrderSessionStore(sql);

    const session = await store.updateOrderSession("room_123", {
      state: "confirming_preferences",
      confirmedPreferences: { allergies: ["peanuts"] },
    });

    expect(session.state).toBe("confirming_preferences");
    expect(session.confirmedPreferences).toEqual({ allergies: ["peanuts"] });
    expect(calls[0]?.params?.[2]).toBe(JSON.stringify({ allergies: ["peanuts"] }));
  });

  test("records AgentPhone webhook deliveries idempotently", async () => {
    const { sql, calls } = createFakeSql([[{ webhook_id: "evt_123" }], []]);
    const store = new OrderSessionStore(sql);

    await expect(
      store.recordWebhookDelivery({
        webhookId: "evt_123",
        eventType: "agent.message",
        roomId: "room_123",
        payload: { channel: "sms" },
      }),
    ).resolves.toBe(true);
    await expect(
      store.recordWebhookDelivery({
        webhookId: "evt_123",
        eventType: "agent.message",
      }),
    ).resolves.toBe(false);

    expect(calls[0]?.params?.[3]).toBe(JSON.stringify({ channel: "sms" }));
  });

  test("lists room participants", async () => {
    const { sql, calls } = createFakeSql([
      [
        {
          participant_id: "participant_123",
          room_id: "room_123",
          phone_number: "+15551234567",
          display_name: "Joe",
          role: "initiator",
          preferences: { dietary: ["vegetarian"] },
          joined_at: "2026-05-17T18:00:00.000Z",
        },
      ],
    ]);
    const store = new OrderSessionStore(sql);

    await expect(store.listParticipants("room_123")).resolves.toEqual([
      {
        participantId: "participant_123",
        roomId: "room_123",
        phoneNumber: "+15551234567",
        displayName: "Joe",
        role: "initiator",
        preferences: { dietary: ["vegetarian"] },
        joinedAt: new Date("2026-05-17T18:00:00.000Z"),
      },
    ]);
    expect(calls[0]?.params).toEqual(["room_123"]);
  });

  test("enqueues and claims background jobs", async () => {
    const jobRow = {
      job_id: "job_123",
      room_id: "room_123",
      kind: "restaurant_search",
      status: "queued",
      attempts: 0,
      run_after: "2026-05-17T18:00:00.000Z",
      locked_at: null,
      last_error: null,
      payload: { query: "thai" },
    };
    const { sql, calls } = createFakeSql([
      [jobRow],
      [{ ...jobRow, status: "running", attempts: 1 }],
    ]);
    const store = new OrderSessionStore(sql);

    const enqueued = await store.enqueueJob({
      jobId: "job_123",
      roomId: "room_123",
      kind: "restaurant_search",
      payload: { query: "thai" },
    });
    const claimed = await store.claimNextJob(["restaurant_search"]);

    expect(enqueued).toMatchObject({ jobId: "job_123", payload: { query: "thai" } });
    expect(claimed).toMatchObject({ status: "running", attempts: 1 });
    expect(calls[1]?.params).toEqual([["restaurant_search"]]);
  });

  test("marks jobs complete or failed", async () => {
    const { sql, calls } = createFakeSql([[], []]);
    const store = new OrderSessionStore(sql);

    await store.completeJob("job_123");
    await store.failJob("job_456", "Browser Use timed out");

    expect(calls[0]?.params).toEqual(["job_123"]);
    expect(calls[1]?.params).toEqual(["job_456", "Browser Use timed out"]);
  });

  test("requeues stale running jobs", async () => {
    const { sql, calls } = createFakeSql([[{ job_id: "job_stale" }]]);
    const store = new OrderSessionStore(sql);

    await expect(store.requeueStaleRunningJobs(120)).resolves.toBe(1);

    expect(calls[0]?.query).toContain("status = 'queued'");
    expect(calls[0]?.query).toContain("locked_at < now()");
    expect(calls[0]?.params).toEqual([120]);
  });
});
