import { AgentPhoneClient } from "agentphone";

import { envWithDefault, requiredEnv, type Env } from "../env.js";
import { BrowserUseModule } from "../modules/browser-use/index.js";
import { SpongeModule } from "../modules/sponge/index.js";
import { StripeModule } from "../modules/stripe/index.js";
import { splitEvenly } from "../modules/split-bill/index.js";
import type { CartSummary, OrderCriteria, RestaurantOption, SplitLineItem } from "../types.js";
import { OrderSessionStore } from "./order-session-store.js";
import type {
  FoodrunJob,
  FoodrunJobKind,
  FoodrunOrderSession,
  FoodrunParticipant,
} from "./order-state.js";
import { shouldPlaceLiveOrders } from "./runtime-config.js";

export const FOODRUN_JOB_MAX_DURATION_SECONDS = 300;

export type ProcessFoodrunJobsResult = {
  processed: number;
  supportedKinds: FoodrunJobKind[];
};

export type FoodrunJobStore = Pick<
  OrderSessionStore,
  | "claimNextJob"
  | "completeJob"
  | "failJob"
  | "getOrderSession"
  | "listParticipants"
  | "updateOrderSession"
  | "appendEvent"
  | "enqueueJob"
>;

export type FoodrunBrowserUse = Pick<BrowserUseModule, "searchRestaurants" | "buildCart">;
export type FoodrunStripe = Pick<StripeModule, "createPaymentLinks">;
export type FoodrunSponge = Pick<SpongeModule, "issueFoodOrderCard">;

export type FoodrunJobNotifier = {
  sendText(input: {
    agentId: string;
    toNumber: string;
    body: string;
    numberId?: string;
  }): Promise<unknown>;
};

export type ProcessFoodrunJobsOptions = {
  store?: FoodrunJobStore;
  browser?: FoodrunBrowserUse;
  stripe?: FoodrunStripe;
  sponge?: FoodrunSponge;
  notifier?: FoodrunJobNotifier | null;
  env?: Env;
};

const SUPPORTED_JOB_KINDS: FoodrunJobKind[] = [
  "restaurant_search",
  "cart_build",
  "cart_edit",
  "checkout_payment",
  "post_order_split",
];

class AgentPhoneJobNotifier implements FoodrunJobNotifier {
  private readonly client: AgentPhoneClient;

  constructor(private readonly env: Env = process.env) {
    this.client = new AgentPhoneClient({
      token: requiredEnv(env, "AGENTPHONE_API_KEY"),
      baseUrl: envWithDefault(env, "AGENTPHONE_API_BASE", "https://api.agentphone.ai").replace(
        /\/v1\/?$/,
        "",
      ),
    });
  }

  sendText(input: {
    agentId: string;
    toNumber: string;
    body: string;
    numberId?: string;
  }): Promise<unknown> {
    return this.client.messages.sendMessage({
      agent_id: input.agentId,
      to_number: input.toNumber,
      body: input.body,
      number_id: input.numberId,
    });
  }
}

export async function processFoodrunJobs(
  limit = 1,
  options: ProcessFoodrunJobsOptions = {},
): Promise<ProcessFoodrunJobsResult> {
  const store = options.store ?? new OrderSessionStore();
  let processed = 0;

  while (processed < limit) {
    const job = await store.claimNextJob(SUPPORTED_JOB_KINDS);

    if (!job) {
      break;
    }

    try {
      await processFoodrunJob(job, { ...options, store });
      await store.completeJob(job.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.failJob(job.jobId, message);
      await notifyJobFailure(job, message, options);
    }

    processed += 1;
  }

  return {
    processed,
    supportedKinds: SUPPORTED_JOB_KINDS,
  };
}

async function processFoodrunJob(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  switch (job.kind) {
    case "restaurant_search":
      await searchRestaurants(job, options);
      return;
    case "cart_build":
      await buildCart(job, options);
      return;
    case "cart_edit":
      await editCart(job, options);
      return;
    case "checkout_payment":
      await handleCheckout(job, options);
      return;
    case "post_order_split":
      await createPostOrderSplits(job, options);
      return;
    default:
      throw new Error(`Unsupported Foodrun job kind: ${job.kind}`);
  }
}

async function searchRestaurants(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  const session = await getSession(options.store, job.roomId);

  if (session.selectedRestaurant || session.cart) {
    if (!session.cart && session.state === "building_cart") {
      await options.store.enqueueJob({
        roomId: job.roomId,
        kind: "cart_build",
        payload: job.payload,
      });
    }
    await options.store.appendEvent({
      roomId: job.roomId,
      eventType: "stale_restaurant_search_skipped",
      payload: { state: session.state },
    });
    return;
  }

  const participants = await options.store.listParticipants(job.roomId);
  const browser = options.browser ?? new BrowserUseModule(options.env);
  const criteria = buildOrderCriteria(session, participants);
  const search = await browser.searchRestaurants(criteria, browserOptions(options.env));
  const restaurant = search.output.restaurants[0];

  if (!restaurant) {
    throw new Error("Browser Use did not return any restaurants");
  }

  await options.store.updateOrderSession(job.roomId, {
    state: "building_cart",
    selectedRestaurant: restaurant,
    browserUseSessionId: search.sessionId,
    browserUseLiveUrl: search.liveUrl,
  });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "browser_use_restaurant_selected",
    payload: {
      restaurant,
      browserUseSessionId: search.sessionId,
      browserUseLiveUrl: search.liveUrl,
    },
  });
  await options.store.enqueueJob({
    roomId: job.roomId,
    kind: "cart_build",
    payload: job.payload,
  });
}

async function buildCart(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  const session = await getSession(options.store, job.roomId);

  if (!session.selectedRestaurant) {
    throw new Error("No restaurant selected for cart build");
  }

  const participants = await options.store.listParticipants(job.roomId);
  const browser = options.browser ?? new BrowserUseModule(options.env);
  const criteria = buildOrderCriteria(session, participants);
  const cart = await browser.buildCart(criteria, session.selectedRestaurant, {
    ...browserOptions(options.env),
    sessionId: session.browserUseSessionId,
  });

  await options.store.updateOrderSession(job.roomId, {
    state: "confirming_cart",
    cart: cart.output,
    browserUseSessionId: cart.sessionId,
    browserUseLiveUrl: cart.liveUrl,
  });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "browser_use_cart_ready",
    payload: {
      restaurant: session.selectedRestaurant,
      cart: cart.output,
      browserUseSessionId: cart.sessionId,
      browserUseLiveUrl: cart.liveUrl,
    },
  });
  await notify(job, options, formatCartReadyText(session.selectedRestaurant, cart.output));
}

async function editCart(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  const session = await getSession(options.store, job.roomId);

  if (!session.selectedRestaurant) {
    throw new Error("No restaurant selected for cart edit");
  }

  const participants = await options.store.listParticipants(job.roomId);
  const criteria = buildOrderCriteria(session, participants, stringPayload(job, "editText"));
  const browser = options.browser ?? new BrowserUseModule(options.env);
  const cart = await browser.buildCart(criteria, session.selectedRestaurant, {
    ...browserOptions(options.env),
    sessionId: session.browserUseSessionId,
  });

  await options.store.updateOrderSession(job.roomId, {
    state: "confirming_cart",
    cart: cart.output,
    browserUseSessionId: cart.sessionId,
    browserUseLiveUrl: cart.liveUrl,
  });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "browser_use_cart_edited",
    payload: { editText: stringPayload(job, "editText"), cart: cart.output },
  });
  await notify(job, options, formatCartReadyText(session.selectedRestaurant, cart.output));
}

async function handleCheckout(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  const session = await getSession(options.store, job.roomId);
  const totalCents = cartTotalCents(session.cart);

  if (!session.cart || !session.selectedRestaurant || !totalCents) {
    throw new Error("Checkout requires a selected restaurant and cart total");
  }

  if (shouldPlaceLiveOrders(options.env)) {
    const sponge = options.sponge ?? new SpongeModule(options.env);
    const card = await sponge.issueFoodOrderCard({
      amountUsd: (totalCents / 100).toFixed(2),
      merchantName: session.selectedRestaurant.name,
      merchantUrl:
        session.cart.checkoutUrl ??
        session.selectedRestaurant.orderingUrl ??
        session.selectedRestaurant.url ??
        "https://example.com",
      products: session.cart.items.map((item) => ({
        name: item.name,
        price: (item.price?.cents ?? 0) / 100,
        quantity: item.quantity,
      })),
    });

    await options.store.updateOrderSession(job.roomId, {
      state: "checking_out",
      spongeCard: card,
    });
    await notify(
      job,
      options,
      "I issued a checkout card. Live browser payment placement is not wired yet, so I stopped before submitting the order.",
    );
    return;
  }

  await options.store.updateOrderSession(job.roomId, {
    state: "splitting_bill",
    orderConfirmation: {
      restaurantName: session.selectedRestaurant.name,
      confirmationNumber: `dry_run_${job.jobId}`,
      finalTotalCents: totalCents,
      raw: { checkoutMode: "dry_run" },
    },
  });
  await options.store.enqueueJob({
    roomId: job.roomId,
    kind: "post_order_split",
    payload: {
      requestedBy: stringPayload(job, "requestedBy"),
      agentId: stringPayload(job, "agentId"),
      agentNumberId: stringPayload(job, "agentNumberId"),
    },
  });
  await notify(
    job,
    options,
    "Dry run: I did not place a real order. I'll create Stripe split links from the draft cart total.",
  );
}

async function createPostOrderSplits(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  const session = await getSession(options.store, job.roomId);
  const participants = await options.store.listParticipants(job.roomId);
  const billable = participants.filter((participant) => participant.phoneNumber);
  const totalCents = session.orderConfirmation?.finalTotalCents ?? cartTotalCents(session.cart);

  if (!totalCents) {
    throw new Error("Cannot split bill without a final total");
  }
  if (billable.length === 0) {
    throw new Error("Cannot split bill without participants");
  }

  const shares = splitEvenly(totalCents, billable.length);
  const splits: SplitLineItem[] = billable.map((participant, index) => ({
    participantId: participant.participantId,
    phoneNumber: participant.phoneNumber,
    amount: { currency: "usd", cents: shares[index] },
    description: `FastTab split - ${session.orderConfirmation?.restaurantName ?? session.cart?.restaurantName ?? "food order"}`,
  }));
  const stripe = options.stripe ?? new StripeModule(options.env);
  const paymentLinks = await stripe.createPaymentLinks(splits, job.roomId);

  await options.store.updateOrderSession(job.roomId, {
    state: "complete",
    stripePaymentLinks: paymentLinks,
  });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "stripe_split_links_created",
    payload: { paymentLinks },
  });

  for (const link of paymentLinks) {
    await notify(job, options, formatPaymentLinkText(link.amountCents, link.url), link.phoneNumber);
  }
}

async function getSession(
  store: FoodrunJobStore,
  roomId: string,
): Promise<FoodrunOrderSession> {
  const session = await store.getOrderSession(roomId);

  if (!session) {
    throw new Error(`Foodrun order session not found: ${roomId}`);
  }

  return session;
}

function buildOrderCriteria(
  session: FoodrunOrderSession,
  participants: FoodrunParticipant[],
  editText?: string,
): OrderCriteria {
  const preferences = [
    ...(session.confirmedPreferences.dietary ?? []),
    ...(session.confirmedPreferences.notes ?? []),
  ];

  if (editText) {
    if (session.cart) {
      preferences.push(`Current cart before changes: ${formatCartForPrompt(session.cart)}`);
    }
    preferences.push(`Cart change requested by text: ${editText}`);
  }

  const location =
    session.confirmedPreferences.address ?? session.confirmedPreferences.location;

  if (!location) {
    throw new Error("Search requires a location or address");
  }

  return {
    roomId: session.roomId,
    location: { raw: location, placeName: location },
    cuisine: session.confirmedPreferences.cuisines?.[0],
    budgetPerPerson:
      session.confirmedPreferences.budgetPerPersonCents ?
        { currency: "usd", cents: session.confirmedPreferences.budgetPerPersonCents }
      : undefined,
    pickupOrDelivery: session.confirmedPreferences.pickupOrDelivery ?? "either",
    participantCount: Math.max(participants.length, 1),
    preferences,
    allergies: session.confirmedPreferences.allergies ?? [],
  };
}

function browserOptions(env: Env = process.env) {
  return {
    keepAlive: true,
    maxCostUsd: Number(env.BROWSER_USE_MAX_COST_USD ?? 2),
    timeoutMs: 240_000,
  };
}

function cartTotalCents(cart: CartSummary | undefined): number | undefined {
  return cart?.estimatedTotal?.cents ?? cart?.subtotal?.cents;
}

function formatCartForPrompt(cart: CartSummary): string {
  const items = cart.items
    .map((item) => {
      const price = item.price ? ` $${(item.price.cents / 100).toFixed(2)}` : "";
      const notes = item.notes ? ` (${item.notes})` : "";

      return `${item.quantity}x ${item.name}${price}${notes}`;
    })
    .join("; ");
  const total = cartTotalCents(cart);

  return [
    cart.restaurantName,
    items ? `items: ${items}` : undefined,
    total ? `total: $${(total / 100).toFixed(2)}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatCartReadyText(restaurant: RestaurantOption, cart: CartSummary): string {
  const total = cartTotalCents(cart);
  const totalLine = total ? ` Estimated total: $${(total / 100).toFixed(2)}.` : "";
  const items = cart.items
    .slice(0, 5)
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(", ");

  return [
    `I built a FastTab draft cart at ${restaurant.name}.${totalLine}`,
    items ? `Items: ${items}` : "",
    cart.blockers.length ? `Blocked by: ${cart.blockers.join(", ")}` : "",
    "Reply with changes, or reply 'confirm order' to continue.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPaymentLinkText(amountCents: number, url: string): string {
  return `FastTab split: your share is $${(amountCents / 100).toFixed(2)}.\nPay here: ${url}`;
}

async function notify(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions,
  body: string,
  toNumber = stringPayload(job, "requestedBy"),
): Promise<void> {
  const agentId = stringPayload(job, "agentId") ?? options.env?.AGENTPHONE_AGENT_ID;

  if (!toNumber || !agentId) {
    return;
  }

  const notifier =
    options.notifier === undefined ? new AgentPhoneJobNotifier(options.env) : options.notifier;

  if (!notifier) {
    return;
  }

  await notifier.sendText({
    agentId,
    toNumber,
    body,
    numberId: stringPayload(job, "agentNumberId"),
  });
}

async function notifyJobFailure(
  job: FoodrunJob,
  message: string,
  options: ProcessFoodrunJobsOptions,
): Promise<void> {
  try {
    await notify(job, options, `FastTab could not finish that step: ${message}`);
  } catch (error) {
    console.error("Foodrun job failure notification failed", error);
  }
}

function stringPayload(job: FoodrunJob, key: string): string | undefined {
  const value = job.payload[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}
