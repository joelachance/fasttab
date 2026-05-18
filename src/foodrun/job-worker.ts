import { AgentPhoneClient } from "agentphone";

import { envWithDefault, requiredEnv, type Env } from "../env.js";
import { BrowserUseModule } from "../modules/browser-use/index.js";
import {
  hasOfficialDirectOrdering,
  prefersMarketplaceOrdering,
} from "../modules/browser-use/ordering-urls.js";
import {
  buildDemoCatalogCart,
  DEMO_CATALOG_CART_SESSION_ID,
  demoRestaurantFromCriteria,
  isDemoCatalogCart,
} from "../modules/demo-catalog-cart.js";
import {
  buildInsomniaCatalogCart,
  INSOMNIA_CATALOG_CART_SESSION_ID,
  insomniaCatalogCartEnabled,
  isInsomniaBrand,
  isInsomniaCatalogCart,
} from "../modules/insomnia-catalog-cart.js";
import { RestaurantAvailabilityModule } from "../modules/restaurant-availability.js";
import { SpongeModule, type FoodOrderCard } from "../modules/sponge/index.js";
import { StripeModule } from "../modules/stripe/index.js";
import { splitEvenly } from "../modules/split-bill/index.js";
import type { CartSummary, OrderCriteria, RestaurantOption, SplitLineItem } from "../types.js";
import { OrderSessionStore } from "./order-session-store.js";
import type {
  ConfirmedPreferences,
  FoodrunJob,
  FoodrunJobKind,
  FoodrunOrderSession,
  FoodrunParticipant,
} from "./order-state.js";
import { resolveCustomerDeliveryPhone } from "./customer-phone.js";
import {
  isDemoMode,
  shouldPlaceLiveOrders,
  shouldUseDemoCheckout,
  shouldUseDemoRestaurantPipeline,
} from "./runtime-config.js";
import {
  createSupermemoryReader,
  fetchSupermemoryContext,
  supermemoryHints,
  supermemoryQueryFromPreferences,
  type SupermemoryReader,
} from "./supermemory-context.js";

export const FOODRUN_JOB_MAX_DURATION_SECONDS = 300;
export const FOODRUN_STALE_JOB_SECONDS = 120;

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
  | "requeueStaleRunningJobs"
  | "updateOrderSession"
  | "appendEvent"
  | "enqueueJob"
>;

export type FoodrunBrowserUse = Pick<
  BrowserUseModule,
  "searchRestaurants" | "buildCart" | "completeCheckout"
>;
export type FoodrunAvailabilityBrowserUse = FoodrunBrowserUse & {
  verifyRestaurantCandidates?: BrowserUseModule["verifyRestaurantCandidates"];
};
export type FoodrunAvailabilityScanner = Pick<RestaurantAvailabilityModule, "findCandidates">;
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
  browser?: FoodrunAvailabilityBrowserUse;
  availabilityScanner?: FoodrunAvailabilityScanner;
  stripe?: FoodrunStripe;
  sponge?: FoodrunSponge;
  memory?: SupermemoryReader | null;
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

// Default limit=1 keeps each Vercel cron invocation within maxDuration when cart builds use long Browser Use timeouts.
export async function processFoodrunJobs(
  limit = 1,
  options: ProcessFoodrunJobsOptions = {},
): Promise<ProcessFoodrunJobsResult> {
  const store = options.store ?? new OrderSessionStore();
  let processed = 0;

  if ("requeueStaleRunningJobs" in store) {
    const requeuedJobs = await store.requeueStaleRunningJobs(FOODRUN_STALE_JOB_SECONDS);

    for (const requeuedJob of requeuedJobs) {
      await notifyStaleJobRequeued(requeuedJob, { ...options, store });
    }
  }

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
      await handleJobFailure(job, message, { ...options, store });
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
  const availabilityScanner =
    options.availabilityScanner ?? new RestaurantAvailabilityModule(options.env ?? process.env);
  await ensureSupermemoryContext(job, session, participants, options);
  const sessionAfterMemory = await getSession(options.store, job.roomId);
  const criteria = buildOrderCriteria(sessionAfterMemory, participants, undefined, options.env);

  if (shouldUseDemoRestaurantPipeline(options.env)) {
    const restaurant = demoRestaurantFromCriteria(criteria);

    await options.store.updateOrderSession(job.roomId, {
      state: "building_cart",
      selectedRestaurant: restaurant,
      browserUseSessionId: null,
      browserUseLiveUrl: null,
    });
    await options.store.appendEvent({
      roomId: job.roomId,
      eventType: "demo_restaurant_selected",
      payload: { restaurant },
    });
    await options.store.enqueueJob({
      roomId: job.roomId,
      kind: "cart_build",
      payload: job.payload,
    });
    await notify(
      job,
      options,
      `Status: demo mode. Using ${restaurant.name} (not a real restaurant). Building your draft cart now.`,
    );
    return;
  }

  const marketplaceRestaurant = marketplaceRestaurantFromPreferences(session.confirmedPreferences);

  if (marketplaceRestaurant) {
    if (hasOfficialDirectOrdering(marketplaceRestaurant)) {
      await options.store.updateOrderSession(job.roomId, {
        state: "building_cart",
        selectedRestaurant: {
          ...marketplaceRestaurant,
          orderingUrl: "https://insomniacookies.com/",
          reason: "User requested Insomnia Cookies. FastTab will try the official site first.",
        },
        browserUseSessionId: null,
        browserUseLiveUrl: null,
      });
      await options.store.enqueueJob({
        roomId: job.roomId,
        kind: "cart_build",
        payload: job.payload,
      });
      await notify(
        job,
        options,
        `Status: building cart. I found ${marketplaceRestaurant.name}. I'm opening insomniacookies.com for a delivery cart now.`,
      );
      return;
    }

    if (prefersMarketplaceOrdering(criteria, marketplaceRestaurant)) {
      await options.store.updateOrderSession(job.roomId, {
        state: "building_cart",
        selectedRestaurant: marketplaceRestaurant,
        browserUseSessionId: null,
        browserUseLiveUrl: null,
      });
      await options.store.enqueueJob({
        roomId: job.roomId,
        kind: "cart_build",
        payload: job.payload,
      });
      await notify(
        job,
        options,
        `Status: building cart. I found ${marketplaceRestaurant.name}. I'm checking Grubhub and DoorDash for a delivery cart now.`,
      );
      return;
    }
  }

  const candidates = await availabilityScanner.findCandidates(criteria);
  const search =
    candidates.length > 0 && browser.verifyRestaurantCandidates ?
      await browser.verifyRestaurantCandidates(criteria, candidates, availabilityBrowserOptions(options.env))
    : await browser.searchRestaurants(criteria, availabilityBrowserOptions(options.env));
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
      candidates,
      browserUseSessionId: search.sessionId,
      browserUseLiveUrl: search.liveUrl,
    },
  });
  await options.store.enqueueJob({
    roomId: job.roomId,
    kind: "cart_build",
    payload: job.payload,
  });
  await notify(job, options, formatRestaurantFoundText(restaurant));
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
  const criteria = buildOrderCriteria(session, participants, undefined, options.env);
  const cart = await buildCartWithFallback(
    browser,
    criteria,
    session.selectedRestaurant,
    {
      ...browserOptions(options.env, session),
    },
    options.env,
  );

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
  const criteria = buildOrderCriteria(session, participants, stringPayload(job, "editText"), options.env);
  const browser = options.browser ?? new BrowserUseModule(options.env);
  const cart = await buildCartWithFallback(
    browser,
    criteria,
    session.selectedRestaurant,
    {
      ...browserOptions(options.env, session),
    },
    options.env,
  );

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

/** Last four digits only — safe for logs and user-facing errors. */
export function maskCardPan(pan: string | undefined): string | undefined {
  const digits = pan?.replace(/\D/g, "");

  if (!digits || digits.length < 4) {
    return undefined;
  }

  return digits.slice(-4);
}

export function spongeCardExpiration(card: FoodOrderCard): string | undefined {
  return (
    card.expiration?.trim() ||
    (card.expiryMonth && card.expiryYear ? `${card.expiryMonth}/${card.expiryYear}` : undefined)
  );
}

export function checkoutPaymentCardFromSponge(card: FoodOrderCard): {
  cardNumber: string;
  cvc: string;
  expiration: string;
  cardholderName?: string;
} {
  const cardNumber = card.cardNumber?.trim();
  const cvc = card.cvc?.trim();
  const expiration = spongeCardExpiration(card);

  if (!cardNumber || !cvc || !expiration) {
    throw new Error("Sponge card is missing card number, CVC, or expiration for browser checkout");
  }

  return {
    cardNumber,
    cvc,
    expiration,
    cardholderName: card.cardholderName?.trim() || undefined,
  };
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

  if (
    !shouldPlaceLiveOrders(options.env) ||
    shouldUseDemoCheckout(session.state, options.env) ||
    isDemoCatalogCart(session.cart)
  ) {
    await completeDryRunCheckout(job, options, session, totalCents);
    return;
  }

  const participants = await options.store.listParticipants(job.roomId);
  const criteria = buildOrderCriteria(session, participants, undefined, options.env);
  const checkoutUrl =
    session.cart.checkoutUrl ??
    session.selectedRestaurant.orderingUrl ??
    session.selectedRestaurant.url;

  if (!checkoutUrl) {
    throw new Error("Checkout requires a restaurant checkout URL");
  }

  const sponge = options.sponge ?? new SpongeModule(options.env);
  const card = await sponge.issueFoodOrderCard({
    amountUsd: foodOrderCardAmountUsd(totalCents, options.env),
    merchantName: session.selectedRestaurant.name,
    merchantUrl: checkoutUrl,
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
    "Status: placing your order on the restaurant site now. I'll text you when it's confirmed or if checkout fails.",
  );

  const browser = options.browser ?? new BrowserUseModule(options.env);
  const placement = await browser.completeCheckout(
    {
      criteria,
      restaurant: session.selectedRestaurant,
      cart: session.cart,
      card: checkoutPaymentCardFromSponge(card),
      checkoutUrl,
    },
    checkoutBrowserOptions(options.env, session),
  );

  await options.store.updateOrderSession(job.roomId, {
    browserUseSessionId: placement.sessionId,
    browserUseLiveUrl: placement.liveUrl,
  });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "browser_use_checkout_placement",
    payload: {
      status: placement.output.status,
      confirmationNumber: placement.output.confirmationNumber,
      blockers: placement.output.blockers,
      cardLast4: maskCardPan(card.cardNumber),
    },
  });

  if (placement.output.status !== "placed") {
    const blockerText =
      placement.output.blockers.length ?
        placement.output.blockers.join(", ")
      : `checkout ${placement.output.status}`;
    const cardHint = maskCardPan(card.cardNumber);

    await notify(
      job,
      options,
      [
        "Status: checkout failed. I could not place the order on the restaurant site.",
        cardHint ? `Virtual card ending ${cardHint} was not charged successfully.` : "",
        `Blocked by: ${blockerText}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    throw new Error(`Browser checkout ${placement.output.status}: ${blockerText}`);
  }

  const finalTotalCents =
    placement.output.finalTotalUsd === undefined ?
      totalCents
    : Math.round(placement.output.finalTotalUsd * 100);
  const confirmationNumber = placement.output.confirmationNumber?.trim();

  await options.store.updateOrderSession(job.roomId, {
    state: "splitting_bill",
    orderConfirmation: {
      restaurantName: session.selectedRestaurant.name,
      confirmationNumber: confirmationNumber || undefined,
      receiptUrl: placement.output.receiptUrl,
      finalTotalCents,
      eta: placement.output.eta,
      raw: placement.output,
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

  const confirmationLine =
    confirmationNumber ? ` Confirmation: ${confirmationNumber}.` : "";
  const totalLine = ` Total: $${(finalTotalCents / 100).toFixed(2)}.`;

  await notify(
    job,
    options,
    `Status: order placed at ${session.selectedRestaurant.name}.${confirmationLine}${totalLine} I'll text Stripe split links next.`,
  );
}

async function completeDryRunCheckout(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
  session: FoodrunOrderSession,
  totalCents: number,
): Promise<void> {
  const demoCheckout = shouldUseDemoCheckout(session.state, options.env);

  await options.store.updateOrderSession(job.roomId, {
    state: "splitting_bill",
    orderConfirmation: {
      restaurantName: session.selectedRestaurant!.name,
      confirmationNumber: `dry_run_${job.jobId}`,
      finalTotalCents: totalCents,
      raw: {
        checkoutMode: "dry_run",
        ...(demoCheckout ? { paymentApproved: true, demoMode: true } : {}),
      },
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
    demoCheckout ?
      "Status: demo checkout complete (payment approved). No real restaurant order or card charge. I'll text Stripe split links from your cart total."
    : "Status: test checkout complete. Dry run: I did not place a real order. I'll create Stripe split links from the draft cart total.",
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

async function ensureSupermemoryContext(
  job: FoodrunJob,
  session: FoodrunOrderSession,
  participants: FoodrunParticipant[],
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  if (session.supermemoryContext.length > 0) {
    return;
  }

  const phoneNumber =
    session.initiatorPhoneNumber ||
    participants.find((participant) => participant.phoneNumber)?.phoneNumber;

  if (!phoneNumber) {
    return;
  }

  const memory =
    options.memory === undefined ? createSupermemoryReader(options.env) : options.memory;

  if (!memory) {
    return;
  }

  const context = await fetchSupermemoryContext(
    phoneNumber,
    supermemoryQueryFromPreferences(session.confirmedPreferences),
    memory,
  );

  if (context.length === 0) {
    return;
  }

  await options.store.updateOrderSession(job.roomId, { supermemoryContext: context });
  await options.store.appendEvent({
    roomId: job.roomId,
    eventType: "supermemory_context_loaded",
    payload: { count: context.length },
  });
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
  env?: Env,
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

  const memoryHints = supermemoryHints(session.supermemoryContext);

  if (memoryHints.length) {
    preferences.push(`Known preferences from past orders: ${memoryHints.join("; ")}`);
  }

  const location =
    session.confirmedPreferences.address ??
    session.confirmedPreferences.location ??
    session.selectedRestaurant?.address;

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
    deliveryPhone: resolveCustomerDeliveryPhone(session, participants, env),
  };
}

function cartBuildTimeoutMs(env: Env = process.env): number {
  return Number(envWithDefault(env, "BROWSER_USE_CART_TIMEOUT_MS", "270000"));
}

function checkoutPlacementTimeoutMs(env: Env = process.env): number {
  return Number(envWithDefault(env, "BROWSER_USE_CHECKOUT_TIMEOUT_MS", "270000"));
}

function checkoutBrowserOptions(
  env: Env = process.env,
  session?: Pick<FoodrunOrderSession, "browserUseSessionId">,
) {
  return {
    ...browserOptions(env, session),
    timeoutMs: checkoutPlacementTimeoutMs(env),
  };
}

const BROWSER_USE_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only real Browser Use session UUIDs can be resumed; catalog/demo ids are local markers. */
export function browserUseResumeSessionId(sessionId?: string | null): string | undefined {
  if (!sessionId) {
    return undefined;
  }

  return BROWSER_USE_SESSION_ID.test(sessionId) ? sessionId : undefined;
}

function browserOptions(env: Env = process.env, session?: Pick<FoodrunOrderSession, "browserUseSessionId">) {
  const sessionId = browserUseResumeSessionId(session?.browserUseSessionId);

  return {
    keepAlive: true,
    maxCostUsd: Number(env.BROWSER_USE_MAX_COST_USD ?? 2),
    timeoutMs: cartBuildTimeoutMs(env),
    ...(sessionId ? { sessionId } : {}),
  };
}

function availabilityBrowserOptions(env: Env = process.env) {
  return browserOptions(env);
}

async function buildCartWithFallback(
  browser: FoodrunBrowserUse,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options: Parameters<FoodrunBrowserUse["buildCart"]>[2],
  env: Env = process.env,
): ReturnType<FoodrunBrowserUse["buildCart"]> {
  if (shouldUseDemoRestaurantPipeline(env)) {
    const output = buildDemoCatalogCart(criteria, restaurant);

    return {
      sessionId: DEMO_CATALOG_CART_SESSION_ID,
      output,
      raw: {
        id: DEMO_CATALOG_CART_SESSION_ID,
        output,
      } as Awaited<ReturnType<FoodrunBrowserUse["buildCart"]>>["raw"],
    };
  }

  if (insomniaCatalogCartEnabled(env) && isInsomniaBrand(restaurant, criteria)) {
    const output = buildInsomniaCatalogCart(criteria, restaurant);

    return {
      sessionId: INSOMNIA_CATALOG_CART_SESSION_ID,
      output,
      raw: {
        id: INSOMNIA_CATALOG_CART_SESSION_ID,
        output,
      } as Awaited<ReturnType<FoodrunBrowserUse["buildCart"]>>["raw"],
    };
  }

  try {
    const cart = await browser.buildCart(criteria, restaurant, options);

    if (cart.output.status === "blocked" && cart.output.items.length === 0) {
      return {
        ...cart,
        output: buildInternalDraftCart(criteria, restaurant, cart.output.blockers),
        raw: {
          ...cart.raw,
          output: buildInternalDraftCart(criteria, restaurant, cart.output.blockers),
        },
      };
    }

    return cart;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = buildInternalDraftCart(criteria, restaurant, [message]);

    return {
      sessionId: "internal_draft_cart",
      output,
      raw: {
        id: "internal_draft_cart",
        output,
      } as Awaited<ReturnType<FoodrunBrowserUse["buildCart"]>>["raw"],
    };
  }
}

function buildInternalDraftCart(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  blockers: string[],
): CartSummary {
  const itemCount = Math.max(1, Math.min(criteria.participantCount, 4));
  const priceCents =
    restaurant.estimatedTotal?.cents ??
    criteria.budgetPerPerson?.cents ??
    1800;
  const unitPriceCents = Math.max(1, Math.round(priceCents / itemCount));
  const itemNames = fallbackItemNames(criteria, restaurant);
  const items = Array.from({ length: itemCount }, (_, index) => ({
    name: itemNames[index % itemNames.length],
    quantity: 1,
    price: { currency: "usd" as const, cents: unitPriceCents },
    notes: fallbackItemNotes(criteria),
  }));
  const subtotalCents = items.reduce((sum, item) => sum + item.price.cents * item.quantity, 0);

  return {
    restaurantName: restaurant.name,
    checkoutUrl: restaurant.orderingUrl ?? restaurant.url,
    items,
    subtotal: { currency: "usd", cents: subtotalCents },
    estimatedTotal: { currency: "usd", cents: subtotalCents },
    screenshots: [],
    status: "draft",
    blockers: [
      "Browser Use could not create a checkout-ready website cart, so FastTab built an internal draft cart.",
      ...blockers.map(formatFailureReason),
    ],
  };
}

function fallbackItemNames(criteria: OrderCriteria, restaurant: RestaurantOption): string[] {
  const text = [criteria.cuisine, restaurant.name, restaurant.reason, ...criteria.preferences]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("thai")) {
    return ["Green curry with tofu", "Drunken noodles with tofu", "Vegetable spring rolls"];
  }
  if (text.includes("indian")) {
    return ["Vegetable curry", "Chana masala", "Garlic naan"];
  }
  if (text.includes("mexican") || text.includes("taco")) {
    return ["Vegetarian burrito", "Bean and cheese tacos", "Chips and salsa"];
  }
  if (text.includes("pizza") || text.includes("italian")) {
    return ["Margherita pizza", "Vegetarian pasta", "Caesar salad"];
  }
  if (text.includes("sushi") || text.includes("japanese")) {
    return ["Avocado roll", "Vegetable udon", "Edamame"];
  }
  if (text.includes("insomnia") || text.includes("cookie")) {
    return ["Classic Chocolate Chunk", "Deluxe Chocolate Chunk", "Snickerdoodle"];
  }

  return ["Vegetarian entree", "Vegetable side", "Group appetizer"];
}

function fallbackItemNotes(criteria: OrderCriteria): string | undefined {
  const notes = [
    criteria.allergies.length ? `avoid ${criteria.allergies.join(", ")}` : undefined,
    criteria.preferences.length ? criteria.preferences.join(", ") : undefined,
  ].filter(Boolean);

  return notes.length ? notes.join("; ") : undefined;
}

/** Cart total for checkout; falls back to priced line items when header totals are missing. */
export function cartTotalCents(cart: CartSummary | undefined): number | undefined {
  if (!cart) {
    return undefined;
  }

  if (cart.estimatedTotal?.cents !== undefined) {
    return cart.estimatedTotal.cents;
  }
  if (cart.subtotal?.cents !== undefined) {
    return cart.subtotal.cents;
  }

  let itemTotal = 0;
  let pricedLineCount = 0;

  for (const item of cart.items) {
    const unitCents = item.price?.cents;

    if (unitCents === undefined) {
      continue;
    }

    pricedLineCount += 1;
    itemTotal += unitCents * item.quantity;
  }

  if (pricedLineCount === 0) {
    return undefined;
  }

  return itemTotal + (cart.taxesAndFees?.cents ?? 0);
}

/** Live checkout card limit: max(cart total, SPONGE_FOOD_ORDER_CARD_AMOUNT_USD floor). */
export function foodOrderCardAmountUsd(totalCents: number, env: Env = process.env): string {
  const floorUsd = Number.parseFloat(
    envWithDefault(env, "SPONGE_FOOD_ORDER_CARD_AMOUNT_USD", "75"),
  );
  const floorCents = Number.isFinite(floorUsd) ? Math.round(floorUsd * 100) : 7500;

  return (Math.max(totalCents, floorCents) / 100).toFixed(2);
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
  const statusLine =
    cart.status === "blocked" ? "Status: cart blocked."
    : cart.status === "draft" ? "Status: draft cart ready."
    : "Status: checkout-ready cart.";

  const blockerLine = formatCartBlockerLine(cart);

  return [
    statusLine,
    cart.status === "blocked" ?
      `I could not build a checkout-ready cart at ${restaurant.name}.${totalLine}`
    : isDemoCatalogCart(cart) ?
      `FastTab demo cart (not a real order) from ${restaurant.name}.${totalLine}`
    : isInsomniaCatalogCart(cart) ?
      `I built a demo cart from the Insomnia Cookies menu for your group.${totalLine}`
    : `I checked ${restaurant.name} and built this FastTab option.${totalLine}`,
    items ? `Items: ${items}` : "",
    blockerLine,
    cart.status === "blocked" ?
      "Reply 'retry cart' to try again, or send a different restaurant or preference."
    : "Reply 'confirm order' to approve this option, 'no' to try another restaurant, or send changes.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCartBlockerLine(cart: CartSummary): string {
  if (isDemoCatalogCart(cart) || isInsomniaCatalogCart(cart)) {
    return cart.blockers[0] ?? "";
  }

  if (cart.blockers.length) {
    return `Blocked by: ${cart.blockers.join(", ")}`;
  }

  return "";
}

function formatRestaurantFoundText(restaurant: RestaurantOption): string {
  const pickup = restaurant.estimatedPickupTime ? ` Pickup estimate: ${restaurant.estimatedPickupTime}.` : "";

  return `Status: building cart. I found ${restaurant.name}.${pickup} I'm building a draft cart now.`;
}

function formatPaymentLinkText(amountCents: number, url: string): string {
  return `Status: split ready. FastTab split: your share is $${(amountCents / 100).toFixed(2)}.\nPay here: ${url}`;
}

async function notifyStaleJobRequeued(
  job: FoodrunJob,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  if (job.kind !== "cart_build" && job.kind !== "cart_edit") {
    return;
  }

  const session = await options.store.getOrderSession(job.roomId);
  const restaurantName = session?.selectedRestaurant?.name ?? "your restaurant";

  try {
    await notify(
      job,
      options,
      [
        "Status: still building cart.",
        `${restaurantName} is taking longer than expected — I'm retrying now and will text when the draft cart is ready.`,
      ].join("\n"),
    );
  } catch (error) {
    console.error("Foodrun stale job requeue notification failed", error);
  }
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

async function handleJobFailure(
  job: FoodrunJob,
  message: string,
  options: ProcessFoodrunJobsOptions & { store: FoodrunJobStore },
): Promise<void> {
  if (job.kind === "restaurant_search") {
    const session = await options.store.getOrderSession(job.roomId);
    const cuisine = session?.confirmedPreferences.cuisines?.[0] ?? "that cuisine";

    await options.store.updateOrderSession(job.roomId, { state: "confirming_preferences" });
    await options.store.appendEvent({
      roomId: job.roomId,
      eventType: "browser_use_restaurant_search_failed",
      payload: { error: message, jobKind: job.kind },
    });
    await notify(job, options, formatRestaurantSearchFailureMessage(message, cuisine));
    return;
  }

  if (job.kind === "cart_build") {
    const session = await options.store.getOrderSession(job.roomId);
    const restaurantName = session?.selectedRestaurant?.name ?? "the restaurant";

    await options.store.updateOrderSession(job.roomId, { state: "selecting_restaurant" });
    await options.store.appendEvent({
      roomId: job.roomId,
      eventType: "browser_use_cart_failed",
      payload: { error: message, jobKind: job.kind },
    });
    await notify(
      job,
      options,
      [
        "Status: cart retry needed.",
        `I found ${restaurantName}, but couldn't build a draft cart yet.`,
        `Reason: ${formatFailureReason(message)}`,
        "Reply 'retry cart' and I'll try again.",
      ].join("\n"),
    );
    return;
  }

  if (job.kind === "cart_edit") {
    await options.store.updateOrderSession(job.roomId, { state: "confirming_cart" });
    await options.store.appendEvent({
      roomId: job.roomId,
      eventType: "browser_use_cart_failed",
      payload: { error: message, jobKind: job.kind },
    });
    await notify(
      job,
      options,
      [
        "Status: cart change failed.",
        `Reason: ${formatFailureReason(message)}`,
        "Send another change or reply 'retry cart' to rebuild the draft cart.",
      ].join("\n"),
    );
    return;
  }

  await notifyJobFailure(job, message, options);
}

function stringPayload(job: FoodrunJob, key: string): string | undefined {
  const value = job.payload[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatFailureReason(message: string): string {
  const trimmed = message.replace(/\s+/g, " ").trim();

  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

function formatRestaurantSearchFailureMessage(message: string, cuisine: string): string {
  if (/location or address/i.test(message)) {
    return [
      "Status: need a delivery area.",
      "I know what you want to order, but I still need an address or neighborhood before I can check Insomnia, Grubhub, or DoorDash.",
      "Example: Insomnia Cookies delivery to 506 20th St, San Francisco.",
    ].join("\n");
  }

  if (/timed out|did not complete within/i.test(message)) {
    return [
      "Status: restaurant search blocked.",
      `I couldn't verify a currently open ${cuisine} restaurant that is accepting online orders before the browser search timed out.`,
      "How about another open cuisine nearby, or send me a specific restaurant ordering URL?",
    ].join("\n");
  }

  return [
    "Status: restaurant search blocked.",
    formatFailureReason(message),
    "Try another cuisine, add a delivery address, or send a specific restaurant ordering URL.",
  ].join("\n");
}

function marketplaceRestaurantFromPreferences(
  preferences: ConfirmedPreferences,
): RestaurantOption | null {
  const insomnia = preferences.cuisines?.find((cuisine) => /insomnia/i.test(cuisine));

  if (insomnia) {
    return {
      name: insomnia,
      orderingUrl: "https://insomniacookies.com/",
      reason: "User requested Insomnia Cookies. FastTab will try the official site first.",
      dietaryFit: preferences.dietary ?? [],
    };
  }

  return null;
}
