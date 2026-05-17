import Supermemory from "supermemory";

import { envWithDefault, requiredEnv, type Env } from "../env.js";

export type SupermemoryClientLike = {
  add(body: {
    content: string;
    containerTag?: string;
    customId?: string;
    metadata?: Record<string, string | number | boolean | string[]>;
  }): Promise<unknown>;
  search: {
    memories(body: {
      q: string;
      containerTag?: string;
      searchMode?: "memories" | "hybrid" | "documents";
      limit?: number;
    }): Promise<unknown>;
  };
};

export type RememberPreferenceInput = {
  phoneNumber: string;
  content: string;
  roomId?: string;
};

export type SearchPreferencesInput = {
  phoneNumber: string;
  query: string;
  limit?: number;
};

function phoneContainerTag(phoneNumber: string): string {
  return `phone_${phoneNumber.replace(/[^\d]/g, "")}`;
}

export class SupermemoryModule {
  private readonly client: SupermemoryClientLike;

  constructor(env: Env = process.env, client?: SupermemoryClientLike) {
    this.client =
      client ??
      new Supermemory({
        apiKey: requiredEnv(env, "SUPERMEMORY_API_KEY"),
        baseURL: envWithDefault(env, "SUPERMEMORY_API_BASE", "https://api.supermemory.ai"),
      });
  }

  async rememberPreference(input: RememberPreferenceInput): Promise<unknown> {
    return this.client.add({
      content: input.content,
      containerTag: phoneContainerTag(input.phoneNumber),
      customId: input.roomId ? `${input.roomId}-${Date.now()}` : undefined,
      metadata: {
        source: "foodrun",
        phoneNumber: input.phoneNumber,
        ...(input.roomId ? { roomId: input.roomId } : {}),
      },
    });
  }

  async searchPreferences(input: SearchPreferencesInput): Promise<unknown> {
    return this.client.search.memories({
      q: input.query,
      containerTag: phoneContainerTag(input.phoneNumber),
      searchMode: "hybrid",
      limit: input.limit ?? 5,
    });
  }
}
