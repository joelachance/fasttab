import {
  BrowserUse,
  type MessageResponse,
  type BuModel,
  type ProxyCountryCode,
  type RunSessionOptions,
  type SessionResult,
} from "browser-use-sdk/v3";
import { z } from "zod";

import { envWithDefault, requiredEnv, type Env } from "../../env.js";
import type { CartSummary, Money, OrderCriteria, RestaurantOption } from "../../types.js";
import {
  INSOMNIA_B9G3F_DEAL_NAME,
  INSOMNIA_B9G3F_PRODUCT_URL,
  INSOMNIA_DEFAULT_BUNDLE_COUNT,
} from "../insomnia-catalog-cart.js";
import {
  buildOrderingUrlAttempts,
  hasOfficialDirectOrdering,
  isInsomniaRestaurant,
  prefersMarketplaceOrdering,
  shouldDiscoverOrderingProviders,
  shouldTryMarketplaceOrdering,
} from "./ordering-urls.js";

export const BrowserRestaurantOptionSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  orderingUrl: z.string().url().optional(),
  address: z.string().optional(),
  reason: z.string().min(1),
  estimatedPickupTime: z.string().optional(),
  estimatedTotalUsd: z.number().nonnegative().optional(),
  dietaryFit: z.array(z.string()).default([]),
});

export const RestaurantSearchOutputSchema = z.object({
  restaurants: z.array(BrowserRestaurantOptionSchema).min(1),
});

export const CartBuildOutputSchema = z.object({
  restaurantName: z.string().min(1),
  checkoutUrl: z.string().url().optional(),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().positive(),
      assignedTo: z.array(z.string()).optional(),
      notes: z.string().optional(),
      priceUsd: z.number().nonnegative().optional(),
    }),
  ),
  subtotalUsd: z.number().nonnegative().optional(),
  taxesAndFeesUsd: z.number().nonnegative().optional(),
  estimatedTotalUsd: z.number().nonnegative().optional(),
  screenshots: z.array(z.string()).default([]),
  status: z.enum(["draft", "checkout_ready", "blocked"]),
  blockers: z.array(z.string()).default([]),
});

export const CheckoutPlacementOutputSchema = z.object({
  status: z.enum(["placed", "failed", "blocked"]),
  confirmationNumber: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  finalTotalUsd: z.number().nonnegative().optional(),
  eta: z.string().optional(),
  blockers: z.array(z.string()).default([]),
  screenshots: z.array(z.string()).default([]),
});

export type CheckoutPlacementOutput = z.output<typeof CheckoutPlacementOutputSchema>;

export type CheckoutPaymentCard = {
  cardNumber: string;
  cvc: string;
  expiration: string;
  cardholderName?: string;
};

export type CompleteCheckoutInput = {
  criteria: OrderCriteria;
  restaurant: RestaurantOption;
  cart: CartSummary;
  card: CheckoutPaymentCard;
  checkoutUrl: string;
};

export const BrowserPromptOutputSchema = z.object({
  summary: z.string().min(1),
  restaurants: z.array(BrowserRestaurantOptionSchema).default([]),
  cart: CartBuildOutputSchema.optional(),
  blockers: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

export type RestaurantSearchOutput = {
  restaurants: RestaurantOption[];
};
export type CartBuildOutput = CartSummary;
export type BrowserPromptOutput = z.output<typeof BrowserPromptOutputSchema>;

export type BrowserUseRunOptions = {
  model?: string;
  workspaceId?: string;
  sessionId?: string;
  keepAlive?: boolean;
  maxCostUsd?: number;
  timeoutMs?: number;
  intervalMs?: number;
  proxyCountryCode?: string;
  onMessage?: (message: MessageResponse) => void;
};

export type BrowserUseRunResult<T> = {
  sessionId: string;
  output: T;
  liveUrl?: string;
  raw: SessionResult<T>;
};

type BrowserUseClientLike = {
  run<T extends z.ZodType>(
    task: string,
    options: RunSessionOptions & { schema: T },
  ): PromiseLike<SessionResult<z.output<T>>> | AsyncIterable<MessageResponse>;
};

type SessionRunLike<T> =
  | PromiseLike<SessionResult<T>>
  | (AsyncIterable<MessageResponse> & {
      result?: SessionResult<T> | null;
      sessionId?: string | null;
    });

export class BrowserUseModule {
  private readonly client: BrowserUseClientLike;
  private readonly model: string;

  constructor(env: Env = process.env, client?: BrowserUseClientLike) {
    this.model = envWithDefault(env, "BROWSER_USE_MODEL", "gpt-5.4-mini");
    this.client =
      client ??
      new BrowserUse({
        apiKey: requiredEnv(env, "BROWSER_USE_API_KEY"),
        baseUrl: env.BROWSER_USE_API_BASE,
      });
  }

  async runTask<T extends z.ZodType>(
    task: string,
    schema: T,
    options: BrowserUseRunOptions = {},
  ): Promise<BrowserUseRunResult<z.output<T>>> {
    const runOptions: RunSessionOptions & { schema: T } = {
      model: (options.model ?? this.model) as BuModel,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      keepAlive: options.keepAlive,
      maxCostUsd: options.maxCostUsd,
      timeout: options.timeoutMs,
      interval: options.intervalMs,
      proxyCountryCode: options.proxyCountryCode as ProxyCountryCode | undefined,
      schema,
    };
    const run = this.client.run(task, runOptions) as SessionRunLike<z.output<T>>;
    const result: SessionResult<z.output<T>> =
      options.onMessage && isAsyncIterable(run) ?
        await runWithProgress(run, options.onMessage)
      : await (run as PromiseLike<SessionResult<z.output<T>>>);

    if (!result.id) {
      throw new Error("Browser Use session result missing id");
    }

    return {
      sessionId: result.id,
      output: parseBrowserUseJson(result.output, schema),
      liveUrl: result.liveUrl ?? undefined,
      raw: result,
    };
  }

  async searchRestaurants(
    criteria: OrderCriteria,
    options?: BrowserUseRunOptions,
  ): Promise<BrowserUseRunResult<RestaurantSearchOutput>> {
    const result = await this.runTask(
      buildRestaurantSearchPrompt(criteria),
      RestaurantSearchOutputSchema,
      options,
    );

    return {
      ...result,
      output: normalizeRestaurantSearch(result.output),
      raw: {
        ...result.raw,
        output: normalizeRestaurantSearch(result.output),
      },
    };
  }

  async verifyRestaurantCandidates(
    criteria: OrderCriteria,
    candidates: RestaurantOption[],
    options?: BrowserUseRunOptions,
  ): Promise<BrowserUseRunResult<RestaurantSearchOutput>> {
    const result = await this.runTask(
      buildRestaurantAvailabilityPrompt(criteria, candidates),
      RestaurantSearchOutputSchema,
      options,
    );

    return {
      ...result,
      output: normalizeRestaurantSearch(result.output),
      raw: {
        ...result.raw,
        output: normalizeRestaurantSearch(result.output),
      },
    };
  }

  async buildCart(
    criteria: OrderCriteria,
    restaurant: RestaurantOption,
    options?: BrowserUseRunOptions,
  ): Promise<BrowserUseRunResult<CartBuildOutput>> {
    const result = await buildCartWithOrderingProviders(this, criteria, restaurant, options);

    return {
      ...result,
      output: normalizeCart(result.output),
      raw: {
        ...result.raw,
        output: normalizeCart(result.output),
      },
    };
  }

  async completeCheckout(
    input: CompleteCheckoutInput,
    options?: BrowserUseRunOptions,
  ): Promise<BrowserUseRunResult<CheckoutPlacementOutput>> {
    return this.runTask(
      buildCheckoutPlacementPrompt(input),
      CheckoutPlacementOutputSchema,
      options,
    );
  }
}

export type MarketplaceProvider = "grubhub" | "doordash";

export type InsomniaSeededCartPromptContext = {
  orderCode: string;
  bundleCount: number;
  graphqlItemQuantity: number;
  checkoutUrl: string;
  productUrl: string;
};

export type BuildCartPromptOptions = {
  orderingUrl?: string;
  discoverProviders?: boolean;
  useMarketplace?: boolean;
  marketplaceProvider?: MarketplaceProvider;
  /** GraphQL pre-seed before Browser Use (repro / checkout-only). */
  insomniaSeededCart?: InsomniaSeededCartPromptContext;
};

export const OFFICIAL_DIRECT_CART_TIMEOUT_MS = 270_000;
export const MARKETPLACE_FALLBACK_TIMEOUT_MS = 150_000;

/** Split official + Grubhub fallback so sequential attempts stay within one Vercel job budget. */
export function officialDirectCartTimeouts(totalBudgetMs = OFFICIAL_DIRECT_CART_TIMEOUT_MS): {
  officialTimeoutMs: number;
  marketplaceFallbackMs: number;
} {
  const marketplaceFallbackMs = Math.min(MARKETPLACE_FALLBACK_TIMEOUT_MS, totalBudgetMs);
  const officialTimeoutMs = Math.max(60_000, totalBudgetMs - marketplaceFallbackMs);

  return { officialTimeoutMs, marketplaceFallbackMs };
}
export const MARKETPLACE_PARALLEL_TIMEOUT_MS = 120_000;

export async function buildCartWithOrderingProviders(
  browser: Pick<BrowserUseModule, "runTask">,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options?: BrowserUseRunOptions,
): Promise<BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>> {
  const urlAttempts = buildOrderingUrlAttempts(restaurant);
  const blockers: string[] = [];
  let lastResult: BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>> | undefined;

  if (prefersMarketplaceOrdering(criteria, restaurant)) {
    return buildMarketplaceCartInParallel(browser, criteria, restaurant, options);
  }

  if (hasOfficialDirectOrdering(restaurant)) {
    return buildOfficialDirectCartWithFallback(browser, criteria, restaurant, options);
  }

  for (const orderingUrl of urlAttempts) {
    const result = await runCartTaskWithBlockedFallback(
      browser,
      criteria,
      restaurant,
      options,
      { orderingUrl, discoverProviders: false },
    );
    lastResult = result;

    if (isUsefulCartResult(result.output)) {
      return result;
    }

    blockers.push(...result.output.blockers);
  }

  if (
    !prefersMarketplaceOrdering(criteria, restaurant) &&
    (shouldDiscoverOrderingProviders(restaurant) || !isUsefulCartResult(lastResult?.output))
  ) {
    const discovery = await runCartTaskWithBlockedFallback(
      browser,
      criteria,
      restaurant,
      options,
      { discoverProviders: true },
    );
    lastResult = discovery;

    if (isUsefulCartResult(discovery.output)) {
      return discovery;
    }

    blockers.push(...discovery.output.blockers);
  }

  if (shouldTryMarketplaceOrdering(criteria, restaurant) || !isUsefulCartResult(lastResult?.output)) {
    const marketplace = await runCartTaskWithBlockedFallback(
      browser,
      criteria,
      restaurant,
      options,
      { useMarketplace: true },
    );
    lastResult = marketplace;

    if (isUsefulCartResult(marketplace.output)) {
      return marketplace;
    }

    blockers.push(...marketplace.output.blockers);
  }

  return (
    lastResult ?? {
      sessionId: options?.sessionId ?? "browser_use_blocked",
      output: {
        restaurantName: restaurant.name,
        items: [],
        screenshots: [],
        status: "blocked",
        blockers: uniqueStrings(blockers),
      },
      raw: {
        id: options?.sessionId ?? "browser_use_blocked",
        output: uniqueStrings(blockers).join("; "),
      } as unknown as SessionResult<z.output<typeof CartBuildOutputSchema>>,
    }
  );
}

export async function buildOfficialDirectCartWithFallback(
  browser: Pick<BrowserUseModule, "runTask">,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options?: BrowserUseRunOptions,
): Promise<BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>> {
  const totalBudgetMs = options?.timeoutMs ?? OFFICIAL_DIRECT_CART_TIMEOUT_MS;
  const { officialTimeoutMs, marketplaceFallbackMs } = officialDirectCartTimeouts(totalBudgetMs);
  const blockers: string[] = [];
  let lastResult: BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>> | undefined;

  for (const orderingUrl of buildOrderingUrlAttempts(restaurant)) {
    const result = await runCartTaskWithBlockedFallback(
      browser,
      criteria,
      restaurant,
      { ...options, timeoutMs: officialTimeoutMs },
      { orderingUrl, discoverProviders: false },
    );
    lastResult = result;

    if (isUsefulCartResult(result.output)) {
      return result;
    }

    blockers.push(...result.output.blockers);
  }

  const marketplace = await runCartTaskWithBlockedFallback(
    browser,
    criteria,
    restaurant,
    { ...options, timeoutMs: marketplaceFallbackMs },
    { useMarketplace: true, marketplaceProvider: "grubhub" },
  );
  lastResult = marketplace;

  if (isUsefulCartResult(marketplace.output)) {
    return marketplace;
  }

  blockers.push(...marketplace.output.blockers);

  return (
    lastResult ?? {
      sessionId: options?.sessionId ?? "browser_use_blocked",
      output: {
        restaurantName: restaurant.name,
        items: [],
        screenshots: [],
        status: "blocked",
        blockers: uniqueStrings(blockers),
      },
      raw: {
        id: options?.sessionId ?? "browser_use_blocked",
        output: uniqueStrings(blockers).join("; "),
      } as unknown as SessionResult<z.output<typeof CartBuildOutputSchema>>,
    }
  );
}

export async function buildMarketplaceCartInParallel(
  browser: Pick<BrowserUseModule, "runTask">,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options?: BrowserUseRunOptions,
): Promise<BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>> {
  const timeoutMs = Math.min(
    options?.timeoutMs ?? MARKETPLACE_PARALLEL_TIMEOUT_MS,
    MARKETPLACE_PARALLEL_TIMEOUT_MS,
  );
  const providers: MarketplaceProvider[] = ["grubhub", "doordash"];
  const attempts = await Promise.all(
    providers.map((marketplaceProvider) =>
      runCartTaskWithBlockedFallback(
        browser,
        criteria,
        restaurant,
        { ...options, timeoutMs },
        { useMarketplace: true, marketplaceProvider },
      ),
    ),
  );

  const useful = attempts.find((attempt) => isUsefulCartResult(attempt.output));

  if (useful) {
    return useful;
  }

  const best = pickBestCartAttempt(attempts);

  if (best) {
    return best;
  }

  const blockers = uniqueStrings(attempts.flatMap((attempt) => attempt.output.blockers));

  return {
    sessionId: attempts[0]?.sessionId ?? "browser_use_blocked",
    output: {
      restaurantName: restaurant.name,
      items: [],
      screenshots: [],
      status: "blocked",
      blockers: blockers.length ? blockers : ["Grubhub and DoorDash cart builds did not return items."],
    },
    raw: {
      id: attempts[0]?.sessionId ?? "browser_use_blocked",
      output: blockers.join("; "),
    } as unknown as SessionResult<z.output<typeof CartBuildOutputSchema>>,
  };
}

function pickBestCartAttempt(
  attempts: BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>[],
): BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>> | undefined {
  return attempts
    .filter((attempt) => attempt.output.items.length > 0 || attempt.output.checkoutUrl)
    .sort((left, right) => scoreCartAttempt(right.output) - scoreCartAttempt(left.output))[0];
}

function scoreCartAttempt(output: z.output<typeof CartBuildOutputSchema>): number {
  let score = output.items.length * 10;

  if (output.status === "checkout_ready") {
    score += 100;
  }
  if (output.checkoutUrl) {
    score += 20;
  }
  if (output.estimatedTotalUsd !== undefined) {
    score += 5;
  }

  return score;
}

export async function runCartTaskWithBlockedFallback(
  browser: Pick<BrowserUseModule, "runTask">,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options?: BrowserUseRunOptions,
  promptOptions: BuildCartPromptOptions = {},
): Promise<BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>> {
  try {
    return await browser.runTask(
      buildCartPrompt(criteria, restaurant, promptOptions),
      CartBuildOutputSchema,
      options,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!looksLikeStoppedTask(message)) {
      throw error;
    }

    return {
      sessionId: options?.sessionId ?? "browser_use_blocked",
      output: {
        restaurantName: restaurant.name,
        items: [],
        screenshots: [],
        status: "blocked",
        blockers: [message],
      },
      raw: {
        id: options?.sessionId ?? "browser_use_blocked",
        output: message,
      } as unknown as SessionResult<z.output<typeof CartBuildOutputSchema>>,
    };
  }
}

export function buildRestaurantSearchPrompt(criteria: OrderCriteria): string {
  const location = criteria.location.placeName ?? criteria.location.raw;
  const cuisine =
    criteria.cuisine ?? (criteria.surpriseUs ? "surprise us" : "open");
  const budget =
    criteria.budgetPerPerson ?
      `${formatMoney(criteria.budgetPerPerson)} per person`
    : "not specified";
  const preferences = formatList(criteria.preferences);
  const allergies = formatList(criteria.allergies);

  return `
Find restaurant options for a group takeout order. Return structured JSON only.

Safety rails:
- Do not place an order. Do not log in. Do not enter payment information.
- Stop before checkout if ordering requires login, payment, or order placement.

Cartability requirements:
- First run an availability scan. Check hours/open status and online-order availability before evaluating menu fit.
- Prefer restaurants with direct online ordering that lets a guest add items and view a cart before login or payment.
- Prefer Toast first, then Square, ChowNow, BentoBox, Shopify, or an official restaurant ordering page.
- For delivery-only chains such as Insomnia Cookies, or when no direct ordering page exists, Grubhub and DoorDash are acceptable ordering sources.
- Use Uber Eats only if neither direct ordering nor Grubhub/DoorDash can satisfy the request.
- Check the ordering page immediately for "currently not accepting orders", "closed", unavailable pickup, or disabled add-to-cart controls.
- Do not return restaurants that are not currently accepting online orders for the requested pickup/delivery mode.
- Spend no more than about 30 seconds on any single restaurant before moving to another candidate.
- Check at least 3 direct-ordering candidates when possible before concluding the requested cuisine has no availability.
- If a restaurant looks good but is closed, not currently accepting orders, or its cart cannot be built as a guest, skip it and try another restaurant.
- If no ${cuisine} restaurant is currently accepting online orders, return the best currently accepting nearby alternative cuisine instead. In "reason", explicitly say no currently accepting ${cuisine} option was found and why this alternative is open/orderable.
- Return the most cartable option first because the next step will build a sample cart from the first result.

Search criteria:
- Location: ${location}
- Cuisine: ${cuisine}
- Pickup/delivery: ${criteria.pickupOrDelivery}
- Budget: ${budget}
- Participant count: ${criteria.participantCount}
- Preferences: ${preferences}
- Allergies: ${allergies}
${criteria.deadline ? `- Deadline: ${criteria.deadline}` : ""}

Return JSON shaped like:
{
  "restaurants": [
    {
      "name": "Restaurant name",
      "url": "https://example.com",
      "orderingUrl": "https://example.com/order",
      "address": "Street address",
      "reason": "Why this fits",
      "estimatedPickupTime": "15-20 min",
      "estimatedTotalUsd": 71.5,
      "dietaryFit": ["vegetarian options"]
    }
  ]
}
`.trim();
}

export function buildRestaurantAvailabilityPrompt(
  criteria: OrderCriteria,
  candidates: RestaurantOption[],
): string {
  const location = criteria.location.placeName ?? criteria.location.raw;
  const cuisine =
    criteria.cuisine ?? (criteria.surpriseUs ? "surprise us" : "open");
  const budget =
    criteria.budgetPerPerson ?
      `${formatMoney(criteria.budgetPerPerson)} per person`
    : "not specified";

  return `
Verify restaurant availability for a group takeout order. Return structured JSON only.

You are given API-shortlisted restaurant candidates. Browser-use should verify the candidates, not perform broad web search unless all candidates fail.

Availability scan:
- For each candidate, immediately check current hours/open status and whether online ordering is currently accepting pickup/delivery orders.
- Prefer direct ordering pages, especially Toast, Square, ChowNow, BentoBox, Shopify, or official restaurant ordering pages.
- For Insomnia Cookies and similar delivery-only brands, verify Grubhub or DoorDash instead of requiring Toast.
- Skip candidates that are closed, say "currently not accepting orders", have unavailable pickup/delivery, require login before cart, or have disabled add-to-cart controls.
- Spend no more than about 30 seconds on a single candidate before moving on.
- Return the first candidate that is currently open, accepting online orders, and likely cartable as the first restaurant.
- If no ${cuisine} candidate is accepting orders, try one currently accepting nearby alternative cuisine and explain the substitution in "reason".
- Do not place an order. Do not enter payment information.

Search criteria:
- Location: ${location}
- Cuisine: ${cuisine}
- Pickup/delivery: ${criteria.pickupOrDelivery}
- Budget: ${budget}
- Participant count: ${criteria.participantCount}
- Preferences: ${formatList(criteria.preferences)}
- Allergies: ${formatList(criteria.allergies)}

Candidates:
${candidates.map(formatCandidateForPrompt).join("\n")}

Return JSON shaped like:
{
  "restaurants": [
    {
      "name": "Restaurant name",
      "url": "https://example.com",
      "orderingUrl": "https://example.com/order",
      "address": "Street address",
      "reason": "Open now and online ordering accepts pickup. Fits vegetarian/no peanuts.",
      "estimatedPickupTime": "15-20 min",
      "estimatedTotalUsd": 71.5,
      "dietaryFit": ["vegetarian options"]
    }
  ]
}
`.trim();
}

function buildMarketplaceProviderStrategy(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  location: string,
  marketplaceProvider?: MarketplaceProvider,
): string {
  const shared = `
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- Build a guest-visible cart with real menu items and prices when the marketplace allows browsing without payment.
- If login is required before cart, return a draft cart from visible menu prices and note the login blocker.`;

  if (marketplaceProvider === "grubhub") {
    return `
Ordering provider strategy:
${shared}
- Use grubhub.com only. Do not open DoorDash, Uber Eats, or other sites.
- Find the ${restaurant.name} store nearest ${location} that supports ${criteria.pickupOrDelivery}.
- Add a small group cart (about ${criteria.participantCount} items) from the menu.
- Spend at most 75 seconds, then return JSON even if the cart is incomplete.`;
  }

  if (marketplaceProvider === "doordash") {
    return `
Ordering provider strategy:
${shared}
- Use doordash.com only. Do not open Grubhub, Uber Eats, or other sites.
- Find the ${restaurant.name} store nearest ${location} that supports ${criteria.pickupOrDelivery}.
- Add a small group cart (about ${criteria.participantCount} items) from the menu.
- Spend at most 75 seconds, then return JSON even if the cart is incomplete.`;
  }

  return `
Ordering provider strategy:
${shared}
- Search Grubhub and DoorDash for the correct store near ${location}.
- Prefer Grubhub first, then DoorDash.
- Spend up to about 90 seconds across marketplace attempts before returning blocked JSON.`;
}

export function buildCheckoutPlacementPrompt(input: CompleteCheckoutInput): string {
  const location = input.criteria.location.placeName ?? input.criteria.location.raw;
  const items = input.cart.items
    .map((item) => {
      const price = item.price ? ` $${(item.price.cents / 100).toFixed(2)}` : "";
      const notes = item.notes ? ` (${item.notes})` : "";

      return `${item.quantity}x ${item.name}${price}${notes}`;
    })
    .join("; ");
  const estimatedTotal =
    input.cart.estimatedTotal ?
      `$${(input.cart.estimatedTotal.cents / 100).toFixed(2)}`
    : input.cart.subtotal ?
      `$${(input.cart.subtotal.cents / 100).toFixed(2)} (subtotal)`
    : "not specified";
  const cardholder = input.card.cardholderName?.trim();

  return `
Complete checkout and place the food order on the restaurant site. Return structured JSON only.

Context:
- Checkout URL: ${input.checkoutUrl}
- Restaurant: ${input.restaurant.name}
- Pickup/delivery mode: ${input.criteria.pickupOrDelivery}
- Delivery address: ${location}
${input.criteria.deliveryPhone ? `- Customer phone for the order (never an AgentPhone or bot number): ${input.criteria.deliveryPhone}` : ""}
- Cart items: ${items || "see site cart"}
- Estimated total: ${estimatedTotal}
- Preferences: ${formatList(input.criteria.preferences)}
- Allergies: ${formatList(input.criteria.allergies)}

Payment (virtual single-use card — enter exactly when prompted):
- Card number: ${input.card.cardNumber}
- Expiration: ${input.card.expiration}
- CVC: ${input.card.cvc}
${cardholder ? `- Cardholder name: ${cardholder}` : ""}

Instructions:
- Resume the existing browser session when possible and open the checkout URL above.
- Verify the cart matches the items above; adjust quantities only if required for availability.
- Enter the delivery address and customer phone when the site asks for contact or delivery details.
- Complete payment with the card above and submit the order.
- If the final total is within about 15% of the estimated total, proceed; otherwise stop and report a blocker.
- Return "placed" only after the site shows an order confirmation or receipt.
- Return "failed" or "blocked" with blockers if payment is declined, login is required, or placement cannot finish.

Return JSON shaped like:
{
  "status": "placed",
  "confirmationNumber": "ABC123",
  "receiptUrl": "https://example.com/receipt",
  "finalTotalUsd": 35.05,
  "eta": "25-35 min",
  "blockers": [],
  "screenshots": []
}
`.trim();
}

export function buildInsomniaSeededCartStrategy(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  seeded: InsomniaSeededCartPromptContext,
): string {
  const location = criteria.location.placeName ?? criteria.location.raw;

  return `
Ordering provider strategy:
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- FastTab already created a delivery cart via Insomnia's backend (order code ${seeded.orderCode}, ${seeded.graphqlItemQuantity} bundle line qty, ${seeded.bundleCount}× "${INSOMNIA_B9G3F_DEAL_NAME}"). Your browser may not show that cart.
- Start at ${seeded.checkoutUrl}. If the cart already shows "${INSOMNIA_B9G3F_DEAL_NAME}" (${seeded.bundleCount} bundles), confirm delivery to ${location} and stop before payment.
- If the cart is empty, open ${seeded.productUrl} and add exactly ${seeded.bundleCount}× "${INSOMNIA_B9G3F_DEAL_NAME}" using the website UI only (pick any allowed flavors).
- Do NOT use GraphQL, curl, Python, API calls, browser devtools network replay, or any programmatic ordering API.
- If the site asks for a phone number, use the customer delivery phone from Order context (never an AgentPhone or bot number).
- If reCAPTCHA appears at any point, stop immediately: return "status": "blocked" with blockers including "reCAPTCHA" — do not click, solve, or retry the captcha.
- Within 90 seconds: if login or payment blocks checkout, return JSON with blockers immediately — do not loop or explore APIs.
- Do not open Grubhub, DoorDash, or other sites in this attempt.
- Build a guest-visible cart when possible; otherwise return a draft cart from visible menu items.`;
}

export function buildCartPrompt(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  promptOptions: BuildCartPromptOptions = {},
): string {
  const location = criteria.location.placeName ?? criteria.location.raw;
  const orderingUrl =
    promptOptions.orderingUrl ?? restaurant.orderingUrl ?? restaurant.url ?? "not provided";
  const providerStrategy =
    promptOptions.useMarketplace ?
      buildMarketplaceProviderStrategy(criteria, restaurant, location, promptOptions.marketplaceProvider)
    : promptOptions.discoverProviders ?
      `
Ordering provider strategy:
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- Search the web for this restaurant's direct ordering page. Prefer Toast Tab first, then Square Online, ChowNow, BentoBox, Shopify, or the official restaurant order page.
- If no direct ordering page works, try Grubhub and DoorDash for this same restaurant before returning blocked JSON.
- Open the best ordering page you find and build the cart there.
- Spend up to about 90 seconds across provider attempts before returning blocked JSON.
`
    : promptOptions.insomniaSeededCart ?
      buildInsomniaSeededCartStrategy(criteria, restaurant, promptOptions.insomniaSeededCart)
    : hasOfficialDirectOrdering(restaurant) && isInsomniaRestaurant(restaurant) ?
      `
Ordering provider strategy:
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- Start at the ordering URL below. Set delivery to ${location} if prompted.
- Add exactly ${INSOMNIA_DEFAULT_BUNDLE_COUNT}× "${INSOMNIA_B9G3F_DEAL_NAME}" from ${INSOMNIA_B9G3F_PRODUCT_URL} using the website UI only.
- Do NOT use GraphQL, curl, Python, API calls, browser devtools network replay, or any programmatic ordering API.
- If the site asks for a phone number, use the customer delivery phone from Order context (never an AgentPhone or bot number).
- If reCAPTCHA appears, stop immediately: return blocked JSON with "reCAPTCHA" in blockers — do not click or solve it.
- Within 90 seconds: if login or payment blocks checkout, return draft/blocked JSON. Do NOT spend the full session timeout searching.
- Skip login forms and account creation — note them in blockers and return JSON immediately.
- Do not open Grubhub, DoorDash, or other sites in this attempt.
- Build a guest-visible cart when possible; otherwise return a draft cart from visible menu items.
`
    : hasOfficialDirectOrdering(restaurant) ?
      `
Ordering provider strategy:
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- Start at the official ordering URL below. Enter the delivery address if prompted.
- If the site asks for a phone number, use the customer delivery phone from Order context (never an AgentPhone or bot number).
- Within 60 seconds: if checkout is blocked by reCAPTCHA, login, or payment, return JSON with "status": "draft" using visible menu prices.
- Do not open Grubhub, DoorDash, or other sites in this attempt.
`
    : `
Ordering provider strategy:
- Stay on ${restaurant.name}. Do not switch to a different restaurant.
- Start at the ordering URL below. If that page is a white-label host, broken, or cannot build a guest cart, search for Toast Tab, Square, ChowNow, BentoBox, Shopify, or the official order page.
- If direct ordering still fails, try Grubhub and DoorDash for this same restaurant.
- Prefer Toast Tab first when multiple direct ordering providers exist.
- Spend up to about 60 seconds on the starting URL, then up to about 30 more seconds on alternate providers if needed.
`;

  return `
Build a takeout cart for the group and stop before payment. Return raw JSON only.

Safety rails:
- Do not place the order. Do not enter payment information.
${providerStrategy}
- Immediately check whether this restaurant is open and online ordering is currently accepting ${criteria.pickupOrDelivery} orders.
- Confirm that at least one item can be added to a cart as a guest before using "status": "checkout_ready".
- Prefer a real website cart when possible, but an internal draft cart from visible menu items is acceptable if the site blocks checkout after you verify menu/cartability.
- If checkout requires login, payment, unavailable items, or another site blocker after items are visible, still build a draft cart from visible menu items before reporting the blocker.
- Use "status": "draft" when you found plausible menu items at this restaurant but could not make a checkout-ready website cart.
- Use "status": "blocked" only when you cannot find enough menu information to choose items.
- If you cannot complete the website cart for any reason, still return the JSON object with any items you found and blockers explaining what happened.
- Do not answer with prose, markdown, comments, or a "Task stopped" sentence.
- Your final response must be parseable JSON matching the shape below.

Restaurant:
- Name: ${restaurant.name}
- Ordering URL: ${orderingUrl}

Order context:
- Location: ${location}
- Participants: ${criteria.participantCount}
${criteria.deliveryPhone ? `- Delivery phone (customer — use at checkout): ${criteria.deliveryPhone}` : ""}
- Preferences: ${formatList(criteria.preferences)}
- Allergies: ${formatList(criteria.allergies)}

Output rules:
- Return exactly one JSON object and nothing else.
- Use "status": "checkout_ready" only when the cart is built and ready for user confirmation.
- Use "status": "draft" when you have a reasonable internal cart but it is not checkout-ready on the website.
- Use "status": "blocked" only when menu access or another blocker prevents choosing items.
- In draft or blocked cases, "blockers" must explain what prevented a checkout-ready cart.

Return JSON shaped like:
{
  "restaurantName": "${restaurant.name}",
  "checkoutUrl": "https://example.com/cart",
  "items": [
    { "name": "Dish", "quantity": 1, "notes": "No peanuts", "priceUsd": 15.95 }
  ],
  "subtotalUsd": 31.9,
  "taxesAndFeesUsd": 3.15,
  "estimatedTotalUsd": 35.05,
  "screenshots": [],
  "status": "checkout_ready",
  "blockers": []
}
`.trim();
}

export function parseBrowserUseJson<T extends z.ZodType>(
  output: unknown,
  schema: T,
): z.output<T> {
  let parsed: unknown;

  if (typeof output === "string") {
    const trimmed = stripJsonFence(output);

    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        trimmed.startsWith("[Session") ?
          `Browser Use session did not return cart JSON: ${trimmed}`
        : `Browser Use returned invalid JSON: ${message}`,
      );
    }
  } else if (typeof output === "object" && output !== null) {
    parsed = output;
  }

  if (parsed === undefined) {
    throw new Error("Browser Use output must be a JSON string or object");
  }

  return schema.parse(parsed);
}

function looksLikeStoppedTask(message: string): boolean {
  return /Task stopp|not valid JSON|invalid JSON|session did not return cart JSON|\[Session/i.test(
    message,
  );
}

function isUsefulCartResult(
  output: z.output<typeof CartBuildOutputSchema> | undefined,
): boolean {
  if (!output) {
    return false;
  }

  if (output.status === "checkout_ready") {
    return true;
  }

  return output.items.length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function normalizeRestaurantSearch(
  output: z.output<typeof RestaurantSearchOutputSchema>,
): RestaurantSearchOutput {
  return {
    restaurants: output.restaurants.map((restaurant) => ({
      name: restaurant.name,
      url: restaurant.url,
      orderingUrl: restaurant.orderingUrl,
      address: restaurant.address,
      reason: restaurant.reason,
      estimatedPickupTime: restaurant.estimatedPickupTime,
      estimatedTotal:
        restaurant.estimatedTotalUsd === undefined ?
          undefined
        : usd(restaurant.estimatedTotalUsd),
      dietaryFit: restaurant.dietaryFit,
    })),
  };
}

function normalizeCart(output: z.output<typeof CartBuildOutputSchema>): CartBuildOutput {
  return {
    restaurantName: output.restaurantName,
    checkoutUrl: output.checkoutUrl,
    items: output.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      assignedTo: item.assignedTo,
      notes: item.notes,
      price: item.priceUsd === undefined ? undefined : usd(item.priceUsd),
    })),
    subtotal: output.subtotalUsd === undefined ? undefined : usd(output.subtotalUsd),
    taxesAndFees:
      output.taxesAndFeesUsd === undefined ? undefined : usd(output.taxesAndFeesUsd),
    estimatedTotal:
      output.estimatedTotalUsd === undefined ? undefined : usd(output.estimatedTotalUsd),
    screenshots: output.screenshots,
    status: output.status,
    blockers: output.blockers,
  };
}

function usd(n: number): Money {
  return { currency: "usd", cents: Math.round(n * 100) };
}

async function runWithProgress<T>(
  run: AsyncIterable<MessageResponse> & {
    result?: SessionResult<T> | null;
    sessionId?: string | null;
  },
  onMessage: (message: MessageResponse) => void,
): Promise<SessionResult<T>> {
  for await (const message of run) {
    onMessage(message);
  }

  if (!run.result) {
    throw new Error(`Session ${run.sessionId ?? "unknown"} did not complete`);
  }

  return run.result;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<MessageResponse> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatCandidateForPrompt(candidate: RestaurantOption, index: number): string {
  return [
    `${index + 1}. ${candidate.name}`,
    candidate.address ? `   Address: ${candidate.address}` : undefined,
    candidate.url ? `   URL: ${candidate.url}` : undefined,
    candidate.orderingUrl ? `   Ordering URL: ${candidate.orderingUrl}` : undefined,
    `   Reason/source notes: ${candidate.reason}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMoney(money: Money): string {
  return `$${(money.cents / 100).toFixed(2)}`;
}
