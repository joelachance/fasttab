import { OrderSessionStore } from "./order-session-store.js";
import type { ConfirmedPreferences, FoodrunOrderState } from "./order-state.js";
import { SupermemoryModule } from "../modules/supermemory.js";
import type { Env } from "../env.js";

export type FoodrunTextMessage = {
  roomId: string;
  agentId: string;
  fromNumber: string;
  agentNumberId?: string;
  body: string;
  messageId?: string;
  channel: "sms" | "mms" | "imessage";
};

export type FoodrunTextIntakeResult = {
  reply: string;
  state: FoodrunOrderState;
  extracted: ConfirmedPreferences;
};

export type FoodrunTextStore = Pick<
  OrderSessionStore,
  | "createOrderSession"
  | "getOrderSession"
  | "upsertParticipant"
  | "appendEvent"
  | "updateOrderSession"
  | "enqueueJob"
>;

export type FoodrunPreferenceMemory = Pick<SupermemoryModule, "rememberPreference">;

export async function handleFoodrunTextMessage(
  input: FoodrunTextMessage,
  options: {
    store?: FoodrunTextStore;
    memory?: FoodrunPreferenceMemory | null;
    env?: Env;
  } = {},
): Promise<FoodrunTextIntakeResult> {
  const store = options.store ?? new OrderSessionStore();
  const extracted = extractPreferenceFacts(input.body);

  const session = await store.createOrderSession({
    roomId: input.roomId,
    initiatorPhoneNumber: input.fromNumber,
    originalPrompt: input.body,
    state: "collecting_preferences",
  });
  await store.upsertParticipant({
    roomId: input.roomId,
    phoneNumber: input.fromNumber,
    role: "initiator",
    preferences: extracted,
  });
  await store.appendEvent({
    roomId: input.roomId,
    eventType: "agentphone_text_received",
    actorPhoneNumber: input.fromNumber,
    payload: {
      body: input.body,
      channel: input.channel,
      messageId: input.messageId,
      agentNumberId: input.agentNumberId,
    },
  });

  if (canRetryCart(session, input.body)) {
    await store.updateOrderSession(input.roomId, { state: "building_cart" });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "cart_build",
      payload: jobPayload(input),
    });

    return {
      reply: "I'll retry building the FastTab draft cart.",
      state: "building_cart",
      extracted,
    };
  }

  if (isBusy(session.state)) {
    return {
      reply: "I'm still working on that FastTab step. I'll text you when the draft cart is ready.",
      state: session.state,
      extracted,
    };
  }

  if (session.state === "confirming_cart" && isYes(input.body)) {
    return {
      reply: "Reply 'confirm order' to continue, or send changes to the cart.",
      state: "confirming_cart",
      extracted,
    };
  }

  if (isCartEdit(input.body, session.state)) {
    await store.updateOrderSession(input.roomId, { state: "editing_cart" });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "cart_edit",
      payload: jobPayload(input, { editText: input.body }),
    });

    return {
      reply: "Got it. I'll update the cart and text you when the draft is ready.",
      state: "editing_cart",
      extracted,
    };
  }

  if (isOrderConfirmation(input.body, session.state)) {
    if (cartStatus(session.cart) === "blocked") {
      return {
        reply: "I can't confirm that order because the cart is blocked. Reply 'retry cart' or send a cart change.",
        state: session.state,
        extracted,
      };
    }

    await store.updateOrderSession(input.roomId, { state: "issuing_card" });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "checkout_payment",
      payload: jobPayload(input),
    });

    return {
      reply: "Confirmed. I'll prepare checkout. Test mode will not place a real order.",
      state: "issuing_card",
      extracted,
    };
  }

  if (isYes(input.body)) {
    await store.updateOrderSession(input.roomId, { state: "searching_restaurants" });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "restaurant_search",
      payload: jobPayload(input),
    });

    return {
      reply: "Great. I'll search for restaurants that match your preferences.",
      state: "searching_restaurants",
      extracted,
    };
  }

  await store.updateOrderSession(input.roomId, {
    state: "confirming_preferences",
    confirmedPreferences: extracted,
  });
  await rememberExtractedFacts(input, extracted, options.memory ?? createMemory(options.env));

  return {
    reply: formatPreferenceConfirmation(extracted),
    state: "confirming_preferences",
    extracted,
  };
}

export function extractPreferenceFacts(text: string): ConfirmedPreferences {
  const lower = text.toLowerCase();
  const dietary = uniqueMatches(lower, [
    ["vegetarian", /\bvegetarian\b/],
    ["vegan", /\bvegan\b/],
    ["gluten free", /\bgluten[- ]free\b/],
    ["dairy free", /\bdairy[- ]free\b/],
    ["halal", /\bhalal\b/],
    ["kosher", /\bkosher\b/],
  ]);
  const allergies = uniqueMatches(lower, [
    ["peanuts", /\b(no|allergic to|allergy to|without)\s+peanuts?\b|\bpeanut allergy\b/],
    ["tree nuts", /\b(no|allergic to|allergy to|without)\s+tree nuts?\b|\btree nut allergy\b/],
    ["shellfish", /\b(no|allergic to|allergy to|without)\s+shellfish\b|\bshellfish allergy\b/],
    ["dairy", /\b(no|allergic to|allergy to|without)\s+dairy\b|\bdairy allergy\b/],
    ["gluten", /\b(no|allergic to|allergy to|without)\s+gluten\b|\bgluten allergy\b/],
  ]);
  const cuisines = uniqueMatches(lower, [
    ["Thai", /\bthai\b/],
    ["Indian", /\bindian\b/],
    ["Chinese", /\bchinese\b/],
    ["Japanese", /\bjapanese\b|\bsushi\b/],
    ["Mexican", /\bmexican\b|\btacos?\b/],
    ["Italian", /\bitalian\b|\bpizza\b|\bpasta\b/],
    ["Mediterranean", /\bmediterranean\b/],
    ["Korean", /\bkorean\b/],
    ["Vietnamese", /\bvietnamese\b|\bpho\b/],
  ]);
  const location = extractLocation(text);
  const pickupOrDelivery =
    /\bpick\s?up\b|\bpickup\b/.test(lower) ? "pickup"
    : /\bdeliver(?:y)?\b/.test(lower) ? "delivery"
    : undefined;
  const budgetPerPersonCents = extractBudgetPerPersonCents(text);
  const preferences: ConfirmedPreferences = {};

  if (dietary.length) {
    preferences.dietary = dietary;
  }
  if (allergies.length) {
    preferences.allergies = allergies;
  }
  if (cuisines.length) {
    preferences.cuisines = cuisines;
  }
  if (location) {
    preferences.location = location;
  }
  if (pickupOrDelivery) {
    preferences.pickupOrDelivery = pickupOrDelivery;
  }
  if (budgetPerPersonCents) {
    preferences.budgetPerPersonCents = budgetPerPersonCents;
  }

  return preferences;
}

export function formatPreferenceConfirmation(preferences: ConfirmedPreferences): string {
  const facts = preferenceLines(preferences);

  if (facts.length === 0) {
    return "Hi, this is your FastTab agent. What would you like to order?";
  }

  return [
    "Hi, this is your FastTab agent. I have:",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "Reply yes to search restaurants, or send changes.",
  ].join("\n");
}

function preferenceLines(preferences: ConfirmedPreferences): string[] {
  return [
    ...(preferences.cuisines ?? []).map((cuisine) => `${cuisine} food`),
    preferences.location ? `near ${preferences.location}` : undefined,
    ...(preferences.dietary ?? []),
    ...(preferences.allergies ?? []).map((allergy) => `no ${allergy}`),
    preferences.pickupOrDelivery,
    preferences.budgetPerPersonCents ?
      `around $${(preferences.budgetPerPersonCents / 100).toFixed(0)}/person`
    : undefined,
  ].filter((line): line is string => Boolean(line));
}

async function rememberExtractedFacts(
  input: FoodrunTextMessage,
  preferences: ConfirmedPreferences,
  memory: FoodrunPreferenceMemory | null,
): Promise<void> {
  if (!memory) {
    return;
  }

  for (const fact of preferenceLines(preferences)) {
    try {
      await memory.rememberPreference({
        phoneNumber: input.fromNumber,
        content: fact,
        roomId: input.roomId,
      });
    } catch (error) {
      console.error("Supermemory preference write failed", error);
    }
  }
}

function createMemory(env: Env = process.env): FoodrunPreferenceMemory | null {
  return env.SUPERMEMORY_API_KEY ? new SupermemoryModule(env) : null;
}

function uniqueMatches(text: string, patterns: Array<[string, RegExp]>): string[] {
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

function extractLocation(text: string): string | undefined {
  const match = text.match(
    /\b(?:near|around|in|at|deliver(?:y)? to)\s+([^.!?\n,]+(?:\s+[^.!?\n,]+){0,4})/i,
  );

  return match?.[1]?.trim();
}

function extractBudgetPerPersonCents(text: string): number | undefined {
  const match = text.match(/\$?(\d+(?:\.\d{2})?)\s*(?:\/|per)\s*(?:person|head|pp)/i);

  return match ? Math.round(Number(match[1]) * 100) : undefined;
}

function isYes(text: string): boolean {
  return /^(yes|y|yeah|yep|sure|ok|okay|go|search)$/i.test(text.trim());
}

function isRetryCart(text: string): boolean {
  return /\b(retry|try again|rebuild|build)\b.*\bcart\b|\bcart\b.*\b(retry|again|rebuild)\b/i.test(
    text.trim(),
  );
}

function canRetryCart(session: { selectedRestaurant?: unknown; cart?: unknown }, text: string): boolean {
  return Boolean(session.selectedRestaurant && !session.cart && isRetryCart(text));
}

function cartStatus(cart: unknown): string | undefined {
  return cart && typeof cart === "object" && "status" in cart ?
      String((cart as { status?: unknown }).status)
    : undefined;
}

function isBusy(state: string): boolean {
  return ["searching_restaurants", "building_cart", "issuing_card", "checking_out", "splitting_bill"].includes(
    state,
  );
}

function isCartEdit(text: string, state: string): boolean {
  return (
    ["confirming_cart", "editing_cart", "building_cart"].includes(state) &&
    /\b(add|remove|swap|replace|change|instead|no\s+\w+)\b/i.test(text)
  );
}

function isOrderConfirmation(text: string, state: string): boolean {
  return (
    ["confirming_cart", "editing_cart"].includes(state) &&
    /^(confirm|confirm order|place order|checkout|pay)$/i.test(text.trim())
  );
}

function jobPayload(
  input: FoodrunTextMessage,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestedBy: input.fromNumber,
    agentId: input.agentId,
    agentNumberId: input.agentNumberId,
    channel: input.channel,
    ...extra,
  };
}
