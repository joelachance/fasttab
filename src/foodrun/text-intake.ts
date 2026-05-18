import { OrderSessionStore } from "./order-session-store.js";
import type { ConfirmedPreferences, FoodrunOrderState } from "./order-state.js";
import { SupermemoryModule } from "../modules/supermemory.js";
import type { Env } from "../env.js";
import { isDemoMode, shouldPlaceLiveOrders } from "./runtime-config.js";

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

  await store.createOrderSession({
    roomId: input.roomId,
    initiatorPhoneNumber: input.fromNumber,
    originalPrompt: input.body,
    state: "collecting_preferences",
  });
  const session = await store.getOrderSession(input.roomId);

  if (!session) {
    throw new Error(`Order session missing after create: ${input.roomId}`);
  }

  const preferences = mergePreferences(session.confirmedPreferences, extracted);
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
      reply:
        "Status: retrying cart. I'll text you when the draft cart is ready, or if checkout blocks me.",
      state: "building_cart",
      extracted,
    };
  }

  if (isBusy(session.state)) {
    return {
      reply: "Status: still working. I'll text you when this FastTab step finishes or needs input.",
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

  if (session.state === "confirming_cart" && isRestaurantRejection(input.body)) {
    await store.updateOrderSession(input.roomId, {
      state: "searching_restaurants",
      confirmedPreferences: preferencesWithRejectedRestaurant(session.confirmedPreferences, session),
      selectedRestaurant: null,
      cart: null,
      browserUseSessionId: null,
      browserUseLiveUrl: null,
    });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "restaurant_search",
      payload: jobPayload(input),
    });

    return {
      reply:
        "Status: trying another option. I'll check the next restaurant is open and can add to cart, then send it for approval.",
      state: "searching_restaurants",
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
      reply: "Status: updating cart. I'll text you when the revised draft is ready.",
      state: "editing_cart",
      extracted,
    };
  }

  if (hasConfirmableCart(session) && !isOrderConfirmation(input.body, session)) {
    await store.updateOrderSession(input.roomId, { state: "confirming_cart" });

    return {
      reply:
        "Reply 'confirm order' to approve this cart, 'no' to try another restaurant, or send changes.",
      state: "confirming_cart",
      extracted,
    };
  }

  if (isOrderConfirmation(input.body, session)) {
    if (cartStatus(session.cart) === "blocked") {
      return {
        reply:
          "Status: cart blocked. I can't confirm the order until the cart is rebuilt. Reply 'retry cart' or send a cart change.",
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
      reply:
        shouldPlaceLiveOrders(options.env) ?
          "Status: preparing checkout. I'll place the order on the restaurant site with a virtual card and text you when it's done."
        : "Status: preparing checkout. Test mode will not place a real order.",
      state: "issuing_card",
      extracted,
    };
  }

  if (isYes(input.body) && session.state === "confirming_preferences" && !hasConfirmableCart(session)) {
    if (!hasOrderLocation(preferences)) {
      return {
        reply: formatMissingLocationReply(preferences),
        state: "confirming_preferences",
        extracted: preferences,
      };
    }

    await store.updateOrderSession(input.roomId, {
      state: "searching_restaurants",
      confirmedPreferences: preferences,
    });
    await store.enqueueJob({
      roomId: input.roomId,
      kind: "restaurant_search",
      payload: jobPayload(input),
    });

    return {
      reply:
        isDemoMode(options.env) ?
          "Status: demo mode. Building your draft cart now — I'll text when it's ready (not a real restaurant order)."
        : "Status: searching restaurants. I'll text you when I find a match and start the cart.",
      state: "searching_restaurants",
      extracted: preferences,
    };
  }

  await store.updateOrderSession(input.roomId, {
    state: "confirming_preferences",
    confirmedPreferences: preferences,
  });
  await rememberExtractedFacts(input, preferences, options.memory ?? createMemory(options.env));

  return {
    reply: formatPreferenceConfirmation(preferences, options.env),
    state: "confirming_preferences",
    extracted: preferences,
  };
}

export function mergePreferences(
  existing: ConfirmedPreferences,
  incoming: ConfirmedPreferences,
): ConfirmedPreferences {
  return {
    ...existing,
    ...incoming,
    dietary: incoming.dietary ?? existing.dietary,
    allergies: incoming.allergies ?? existing.allergies,
    cuisines: incoming.cuisines?.length ? incoming.cuisines : existing.cuisines,
    address: incoming.address ?? existing.address,
    location: incoming.location ?? existing.location,
    budgetPerPersonCents: incoming.budgetPerPersonCents ?? existing.budgetPerPersonCents,
    pickupOrDelivery: incoming.pickupOrDelivery ?? existing.pickupOrDelivery,
    notes:
      incoming.notes?.length ?
        [...(existing.notes ?? []), ...incoming.notes].filter(
          (note, index, notes) => notes.indexOf(note) === index,
        )
      : existing.notes,
  };
}

export function hasOrderLocation(preferences: ConfirmedPreferences): boolean {
  return Boolean(orderLocation(preferences)?.trim());
}

export function orderLocation(preferences: ConfirmedPreferences): string | undefined {
  return preferences.address ?? preferences.location;
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
    ["Insomnia Cookies", /\binsomnia cookies\b/],
    ["Cookies", /\bcookies?\b/],
    ["Dessert", /\bdesserts?\b|\bsweets?\b|\bbaker(?:y|ies)\b|\bice cream\b/],
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

export function formatPreferenceConfirmation(
  preferences: ConfirmedPreferences,
  env: Env = process.env,
): string {
  const facts = preferenceLines(preferences);
  const demo = isDemoMode(env);

  if (facts.length === 0) {
    return demo ?
        "Hi, this is FastTab (demo mode). Text what you want and where — e.g. cookies to 506 20th St."
      : "Hi, this is your FastTab agent. What would you like to order?";
  }

  if (!hasOrderLocation(preferences)) {
    return [
      demo ? "Hi, this is FastTab (demo mode — not a real order). I have:" : "Hi, this is your FastTab agent. I have:",
      ...facts.map((fact) => `- ${fact}`),
      "",
      demo ?
        "Send a delivery address, then reply yes. Example: cookies to 506 20th St, San Francisco."
      : "Send a delivery address or neighborhood, then reply yes to search.",
      ...(demo ? [] : ["Example: Insomnia Cookies delivery to 506 20th St, San Francisco."]),
    ].join("\n");
  }

  return [
    demo ? "Hi, this is FastTab (demo mode — not a real order). I have:" : "Hi, this is your FastTab agent. I have:",
    ...facts.map((fact) => `- ${fact}`),
    "",
    demo ?
      "Reply yes to build your demo cart (no browser search), or send changes."
    : "Reply yes to search restaurants, or send changes.",
  ].join("\n");
}

function formatMissingLocationReply(preferences: ConfirmedPreferences): string {
  const brand = preferences.cuisines?.find((cuisine) => /insomnia/i.test(cuisine));
  const item = brand ?? preferences.cuisines?.[0] ?? "your order";

  return [
    `I still need a delivery address or neighborhood before I can search for ${item}.`,
    "Example: Insomnia Cookies delivery to 506 20th St, San Francisco.",
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
  const streetAddress = extractStreetAddress(text);

  if (streetAddress) {
    return streetAddress;
  }

  const match = text.match(
    /\b(?:near|around|in|at|deliver(?:y)? to)\s+([^.!?\n,]+(?:\s+[^.!?\n,]+){0,4})/i,
  );

  return match?.[1]?.trim();
}

function extractStreetAddress(text: string): string | undefined {
  const match = text.match(
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}(?:,\s*[A-Za-z .'-]+)?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?\b/,
  );

  return match?.[0]?.trim();
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

function isRestaurantRejection(text: string): boolean {
  return /^(no|nope|nah|try another|different restaurant|another option|not this one)$/i.test(
    text.trim(),
  );
}

function preferencesWithRejectedRestaurant(
  preferences: ConfirmedPreferences,
  session: { selectedRestaurant?: { name?: string } },
): ConfirmedPreferences {
  const name = session.selectedRestaurant?.name;

  if (!name) {
    return preferences;
  }

  const rejectionNote = `Previous option rejected: ${name}. Try a different restaurant.`;

  return {
    ...preferences,
    notes: [...(preferences.notes ?? []).filter((note) => note !== rejectionNote), rejectionNote],
  };
}

function canRetryCart(session: { selectedRestaurant?: unknown; cart?: unknown }, text: string): boolean {
  return Boolean(
    session.selectedRestaurant &&
      (!session.cart || cartStatus(session.cart) === "blocked") &&
      isRetryCart(text),
  );
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

function hasConfirmableCart(session: { cart?: unknown }): boolean {
  const status = cartStatus(session.cart);

  return status === "draft" || status === "checkout_ready";
}

function isOrderConfirmation(
  text: string,
  session: { state: string; cart?: unknown },
): boolean {
  const matchesText = /^(confirm|confirm order|place order|checkout|pay)$/i.test(text.trim());

  if (!matchesText) {
    return false;
  }

  if (["confirming_cart", "editing_cart"].includes(session.state)) {
    return true;
  }

  return hasConfirmableCart(session);
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
