import type { ConfirmedPreferences } from "./order-state.js";
import { SupermemoryModule } from "../modules/supermemory.js";
import type { Env } from "../env.js";

export type SupermemoryReader = Pick<SupermemoryModule, "searchPreferences">;
export type SupermemoryMemory = Pick<SupermemoryModule, "rememberPreference" | "searchPreferences">;

export function supermemoryQueryFromPreferences(preferences: ConfirmedPreferences): string {
  const parts = [
    ...(preferences.cuisines ?? []),
    ...(preferences.dietary ?? []),
    ...(preferences.allergies ?? []).map((allergy) => `no ${allergy}`),
    preferences.location ?? preferences.address,
    preferences.pickupOrDelivery,
    ...(preferences.notes ?? []),
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join(" ") : "food order preferences";
}

export function normalizeSupermemorySearchResult(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;

    if (Array.isArray(record.memories)) {
      return record.memories;
    }

    if (Array.isArray(record.results)) {
      return record.results;
    }
  }

  return [];
}

export function mergeSupermemoryIntoPreferences(
  preferences: ConfirmedPreferences,
  context: unknown[],
): ConfirmedPreferences {
  const hints = supermemoryHints(context);

  if (hints.length === 0) {
    return preferences;
  }

  const memoryNote = `Past preferences: ${hints.join("; ")}`;

  return {
    ...preferences,
    notes: [...(preferences.notes ?? []).filter((note) => note !== memoryNote), memoryNote],
  };
}

export function supermemoryHints(context: unknown[]): string[] {
  const hints: string[] = [];

  for (const entry of context) {
    const text = supermemoryEntryText(entry);

    if (text) {
      hints.push(text);
    }
  }

  return [...new Set(hints)];
}

export async function fetchSupermemoryContext(
  phoneNumber: string,
  query: string,
  memory: SupermemoryReader | null,
): Promise<unknown[]> {
  if (!memory) {
    return [];
  }

  try {
    const result = await memory.searchPreferences({ phoneNumber, query, limit: 5 });

    return normalizeSupermemorySearchResult(result);
  } catch (error) {
    console.error("Supermemory preference search failed", error);

    return [];
  }
}

export function createSupermemoryReader(env: Env = process.env): SupermemoryReader | null {
  return createSupermemoryMemory(env);
}

export function createSupermemoryMemory(env: Env = process.env): SupermemoryMemory | null {
  return env.SUPERMEMORY_API_KEY ? new SupermemoryModule(env) : null;
}

function supermemoryEntryText(entry: unknown): string | undefined {
  if (typeof entry === "string" && entry.trim()) {
    return entry.trim();
  }

  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const candidates = [record.content, record.memory, record.text, record.summary];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}
