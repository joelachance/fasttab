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
    this.model = envWithDefault(env, "BROWSER_USE_MODEL", "claude-sonnet-4.6");
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
    const result = await runCartTaskWithBlockedFallback(
      this,
      criteria,
      restaurant,
      options,
    );

    return {
      ...result,
      output: normalizeCart(result.output),
      raw: {
        ...result.raw,
        output: normalizeCart(result.output),
      },
    };
  }
}

export async function runCartTaskWithBlockedFallback(
  browser: Pick<BrowserUseModule, "runTask">,
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
  options?: BrowserUseRunOptions,
): Promise<BrowserUseRunResult<z.output<typeof CartBuildOutputSchema>>> {
  try {
    return await browser.runTask(buildCartPrompt(criteria, restaurant), CartBuildOutputSchema, options);
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
- Avoid DoorDash, Uber Eats, Grubhub, and other marketplaces unless no direct ordering option exists.
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

export function buildCartPrompt(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): string {
  const location = criteria.location.placeName ?? criteria.location.raw;

  return `
Build a takeout cart for the group and stop before payment. Return raw JSON only.

Safety rails:
- Do not place the order. Do not enter payment information.
- Try only the restaurant listed below. Do not search for or switch to a comparable nearby restaurant.
- Immediately check whether this restaurant is open and online ordering is currently accepting ${criteria.pickupOrDelivery} orders.
- Confirm that at least one item can be added to a cart as a guest before using "status": "checkout_ready".
- Spend at most about 60 seconds trying this restaurant's ordering URL. If it is closed, not accepting orders, requires login before cart, or has disabled add-to-cart controls, return JSON with "status": "blocked" and clear blockers.
- Prefer a real website cart when possible, but an internal draft cart from visible menu items is acceptable if the site blocks checkout after you verify menu/cartability.
- If checkout requires login, payment, unavailable items, or another site blocker after items are visible, still build a draft cart from visible menu items before reporting the blocker.
- Use "status": "draft" when you found plausible menu items at this restaurant but could not make a checkout-ready website cart.
- Use "status": "blocked" only when you cannot find enough menu information to choose items.
- If you cannot complete the website cart for any reason, still return the JSON object with any items you found and blockers explaining what happened.
- Do not answer with prose, markdown, comments, or a "Task stopped" sentence.
- Your final response must be parseable JSON matching the shape below.

Restaurant:
- Name: ${restaurant.name}
- Ordering URL: ${restaurant.orderingUrl ?? restaurant.url ?? "not provided"}

Order context:
- Location: ${location}
- Participants: ${criteria.participantCount}
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
  const parsed =
    typeof output === "string" ? JSON.parse(stripJsonFence(output))
    : typeof output === "object" && output !== null ? output
    : undefined;

  if (parsed === undefined) {
    throw new Error("Browser Use output must be a JSON string or object");
  }

  return schema.parse(parsed);
}

function looksLikeStoppedTask(message: string): boolean {
  return /Task stopp|not valid JSON/i.test(message);
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
