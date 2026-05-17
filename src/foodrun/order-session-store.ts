import { randomUUID } from "node:crypto";

import { createPostgresClient, type FoodrunSqlClient } from "../modules/postgres.js";
import type {
  ConfirmedPreferences,
  FoodrunJob,
  FoodrunJobKind,
  FoodrunOrderSession,
  FoodrunOrderState,
  FoodrunParticipant,
} from "./order-state.js";

type OrderSessionRow = {
  room_id: string;
  state: FoodrunOrderState;
  initiator_phone_number: string;
  agent_phone_number: string | null;
  original_prompt: string | null;
  confirmed_preferences: unknown;
  supermemory_context: unknown;
  selected_restaurant: unknown;
  cart: unknown;
  sponge_card: unknown;
  order_confirmation: unknown;
  stripe_payment_links: unknown;
  browser_use_session_id: string | null;
  browser_use_live_url: string | null;
  idempotency_key: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ParticipantRow = {
  participant_id: string;
  room_id: string;
  phone_number: string;
  display_name: string | null;
  role: "initiator" | "participant";
  preferences: unknown;
  joined_at: Date | string;
};

type JobRow = {
  job_id: string;
  room_id: string;
  kind: FoodrunJobKind;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  run_after: Date | string;
  locked_at: Date | string | null;
  last_error: string | null;
  payload: unknown;
};

export type CreateOrderSessionInput = {
  roomId: string;
  initiatorPhoneNumber: string;
  agentPhoneNumber?: string;
  originalPrompt?: string;
  idempotencyKey?: string;
  state?: FoodrunOrderState;
};

export type UpdateOrderSessionInput = {
  state?: FoodrunOrderState;
  confirmedPreferences?: ConfirmedPreferences;
  supermemoryContext?: unknown[];
  selectedRestaurant?: unknown | null;
  cart?: unknown | null;
  spongeCard?: unknown | null;
  orderConfirmation?: unknown | null;
  stripePaymentLinks?: unknown[];
  browserUseSessionId?: string | null;
  browserUseLiveUrl?: string | null;
};

export class OrderSessionStore {
  constructor(private readonly sql: FoodrunSqlClient = createPostgresClient()) {}

  async createOrderSession(input: CreateOrderSessionInput): Promise<FoodrunOrderSession> {
    const rows = (await this.sql.query(
      `
        INSERT INTO foodrun_order_sessions (
          room_id,
          state,
          initiator_phone_number,
          agent_phone_number,
          original_prompt,
          idempotency_key
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (room_id) DO UPDATE SET
          initiator_phone_number = EXCLUDED.initiator_phone_number,
          agent_phone_number = COALESCE(EXCLUDED.agent_phone_number, foodrun_order_sessions.agent_phone_number),
          original_prompt = COALESCE(EXCLUDED.original_prompt, foodrun_order_sessions.original_prompt),
          idempotency_key = COALESCE(EXCLUDED.idempotency_key, foodrun_order_sessions.idempotency_key)
        RETURNING *
      `,
      [
        input.roomId,
        input.state ?? "collecting_preferences",
        input.initiatorPhoneNumber,
        input.agentPhoneNumber ?? null,
        input.originalPrompt ?? null,
        input.idempotencyKey ?? null,
      ],
    )) as OrderSessionRow[];

    return mapOrderSession(rows[0]);
  }

  async getOrderSession(roomId: string): Promise<FoodrunOrderSession | null> {
    const rows = (await this.sql.query(
      "SELECT * FROM foodrun_order_sessions WHERE room_id = $1",
      [roomId],
    )) as OrderSessionRow[];

    return rows[0] ? mapOrderSession(rows[0]) : null;
  }

  async updateOrderSession(
    roomId: string,
    input: UpdateOrderSessionInput,
  ): Promise<FoodrunOrderSession> {
    const rows = (await this.sql.query(
      `
        UPDATE foodrun_order_sessions SET
          state = COALESCE($2, state),
          confirmed_preferences = CASE WHEN $12 THEN $3::jsonb ELSE confirmed_preferences END,
          supermemory_context = CASE WHEN $13 THEN $4::jsonb ELSE supermemory_context END,
          selected_restaurant = CASE WHEN $14 THEN $5::jsonb ELSE selected_restaurant END,
          cart = CASE WHEN $15 THEN $6::jsonb ELSE cart END,
          sponge_card = CASE WHEN $16 THEN $7::jsonb ELSE sponge_card END,
          order_confirmation = CASE WHEN $17 THEN $8::jsonb ELSE order_confirmation END,
          stripe_payment_links = CASE WHEN $18 THEN $9::jsonb ELSE stripe_payment_links END,
          browser_use_session_id = CASE WHEN $19 THEN $10 ELSE browser_use_session_id END,
          browser_use_live_url = CASE WHEN $20 THEN $11 ELSE browser_use_live_url END
        WHERE room_id = $1
        RETURNING *
      `,
      [
        roomId,
        input.state ?? null,
        optionalJson(input.confirmedPreferences),
        optionalJson(input.supermemoryContext),
        optionalJson(input.selectedRestaurant),
        optionalJson(input.cart),
        optionalJson(input.spongeCard),
        optionalJson(input.orderConfirmation),
        optionalJson(input.stripePaymentLinks),
        input.browserUseSessionId ?? null,
        input.browserUseLiveUrl ?? null,
        hasOwn(input, "confirmedPreferences"),
        hasOwn(input, "supermemoryContext"),
        hasOwn(input, "selectedRestaurant"),
        hasOwn(input, "cart"),
        hasOwn(input, "spongeCard"),
        hasOwn(input, "orderConfirmation"),
        hasOwn(input, "stripePaymentLinks"),
        hasOwn(input, "browserUseSessionId"),
        hasOwn(input, "browserUseLiveUrl"),
      ],
    )) as OrderSessionRow[];

    if (!rows[0]) {
      throw new Error(`Foodrun order session not found: ${roomId}`);
    }

    return mapOrderSession(rows[0]);
  }

  async upsertParticipant(input: {
    roomId: string;
    phoneNumber: string;
    participantId?: string;
    displayName?: string;
    role?: "initiator" | "participant";
    preferences?: ConfirmedPreferences;
  }): Promise<FoodrunParticipant> {
    const rows = (await this.sql.query(
      `
        INSERT INTO foodrun_order_participants (
          participant_id,
          room_id,
          phone_number,
          display_name,
          role,
          preferences
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (room_id, phone_number) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, foodrun_order_participants.display_name),
          role = EXCLUDED.role,
          preferences = EXCLUDED.preferences
        RETURNING *
      `,
      [
        input.participantId ?? randomUUID(),
        input.roomId,
        input.phoneNumber,
        input.displayName ?? null,
        input.role ?? "participant",
        JSON.stringify(input.preferences ?? {}),
      ],
    )) as ParticipantRow[];

    return mapParticipant(rows[0]);
  }

  async listParticipants(roomId: string): Promise<FoodrunParticipant[]> {
    const rows = (await this.sql.query(
      `
        SELECT *
        FROM foodrun_order_participants
        WHERE room_id = $1
        ORDER BY joined_at ASC
      `,
      [roomId],
    )) as ParticipantRow[];

    return rows.map(mapParticipant);
  }

  async appendEvent(input: {
    roomId?: string;
    eventType: string;
    actorPhoneNumber?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.sql.query(
      `
        INSERT INTO foodrun_order_events (
          room_id,
          event_type,
          actor_phone_number,
          payload
        )
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        input.roomId ?? null,
        input.eventType,
        input.actorPhoneNumber ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }

  async recordWebhookDelivery(input: {
    webhookId: string;
    eventType: string;
    roomId?: string;
    payload?: Record<string, unknown>;
  }): Promise<boolean> {
    const rows = (await this.sql.query(
      `
        INSERT INTO agentphone_webhook_deliveries (
          webhook_id,
          event_type,
          room_id,
          payload
        )
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (webhook_id) DO NOTHING
        RETURNING webhook_id
      `,
      [
        input.webhookId,
        input.eventType,
        input.roomId ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    )) as Array<{ webhook_id: string }>;

    return Boolean(rows[0]);
  }

  async enqueueJob(input: {
    roomId: string;
    kind: FoodrunJobKind;
    payload?: Record<string, unknown>;
    runAfter?: Date;
    jobId?: string;
  }): Promise<FoodrunJob> {
    const rows = (await this.sql.query(
      `
        INSERT INTO foodrun_jobs (
          job_id,
          room_id,
          kind,
          payload,
          run_after
        )
        VALUES ($1, $2, $3, $4::jsonb, $5)
        RETURNING *
      `,
      [
        input.jobId ?? randomUUID(),
        input.roomId,
        input.kind,
        JSON.stringify(input.payload ?? {}),
        input.runAfter ?? new Date(),
      ],
    )) as JobRow[];

    return mapJob(rows[0]);
  }

  async requeueStaleRunningJobs(maxAgeSeconds: number): Promise<number> {
    const rows = (await this.sql.query(
      `
        UPDATE foodrun_jobs SET
          status = 'queued',
          locked_at = NULL,
          last_error = 'Requeued after worker stopped responding'
        WHERE status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < now() - ($1 * interval '1 second')
        RETURNING job_id
      `,
      [maxAgeSeconds],
    )) as Array<{ job_id: string }>;

    return rows.length;
  }

  async claimNextJob(kinds: FoodrunJobKind[]): Promise<FoodrunJob | null> {
    if (kinds.length === 0) {
      return null;
    }

    const rows = (await this.sql.query(
      `
        UPDATE foodrun_jobs SET
          status = 'running',
          attempts = attempts + 1,
          locked_at = now()
        WHERE job_id = (
          SELECT job_id
          FROM foodrun_jobs
          WHERE status = 'queued'
            AND run_after <= now()
            AND kind = ANY($1)
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `,
      [kinds],
    )) as JobRow[];

    return rows[0] ? mapJob(rows[0]) : null;
  }

  async completeJob(jobId: string): Promise<void> {
    await this.sql.query(
      `
        UPDATE foodrun_jobs SET
          status = 'succeeded',
          locked_at = NULL,
          last_error = NULL
        WHERE job_id = $1
      `,
      [jobId],
    );
  }

  async failJob(jobId: string, error: string): Promise<void> {
    await this.sql.query(
      `
        UPDATE foodrun_jobs SET
          status = 'failed',
          locked_at = NULL,
          last_error = $2
        WHERE job_id = $1
      `,
      [jobId, error],
    );
  }
}

function mapOrderSession(row?: OrderSessionRow): FoodrunOrderSession {
  if (!row) {
    throw new Error("Foodrun order session query returned no rows");
  }

  return {
    roomId: row.room_id,
    state: row.state,
    initiatorPhoneNumber: row.initiator_phone_number,
    agentPhoneNumber: row.agent_phone_number ?? undefined,
    originalPrompt: row.original_prompt ?? undefined,
    confirmedPreferences: jsonValue(row.confirmed_preferences, {}),
    supermemoryContext: jsonValue(row.supermemory_context, []),
    selectedRestaurant: jsonValue(row.selected_restaurant),
    cart: jsonValue(row.cart),
    spongeCard: jsonValue(row.sponge_card),
    orderConfirmation: jsonValue(row.order_confirmation),
    stripePaymentLinks: jsonValue(row.stripe_payment_links, []),
    browserUseSessionId: row.browser_use_session_id ?? undefined,
    browserUseLiveUrl: row.browser_use_live_url ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapParticipant(row?: ParticipantRow): FoodrunParticipant {
  if (!row) {
    throw new Error("Foodrun participant query returned no rows");
  }

  return {
    participantId: row.participant_id,
    roomId: row.room_id,
    phoneNumber: row.phone_number,
    displayName: row.display_name ?? undefined,
    role: row.role,
    preferences: jsonValue(row.preferences, {}),
    joinedAt: new Date(row.joined_at),
  };
}

function mapJob(row?: JobRow): FoodrunJob {
  if (!row) {
    throw new Error("Foodrun job query returned no rows");
  }

  return {
    jobId: row.job_id,
    roomId: row.room_id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    runAfter: new Date(row.run_after),
    lockedAt: row.locked_at ? new Date(row.locked_at) : undefined,
    lastError: row.last_error ?? undefined,
    payload: jsonValue(row.payload, {}),
  };
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function jsonValue<T>(value: unknown, fallback?: T): T {
  if (value === null || value === undefined) {
    return fallback as T;
  }

  return typeof value === "string" ? JSON.parse(value) : (value as T);
}
