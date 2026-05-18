/**
 * Reproduce Insomnia Cookies + Browser Use reCAPTCHA blocker (founder handoff).
 *
 * Step 1: GraphQL seeds 2× Buy 9 Get 3 Free + delivery address (560 20th St).
 * Step 2: Browser Use opens checkout (or product page if cart empty) — no GraphQL in BU.
 *
 * ## Required env (use `.env.local` or export before run)
 * - BROWSER_USE_API_KEY — Browser Use API key
 * - FOODRUN_DEMO_MODE=false — must not stub restaurant/cart
 * - FOODRUN_INSOMNIA_CATALOG_CART=false — must not skip Browser Use with catalog cart
 * - FOODRUN_DELIVERY_PHONE or --phone — customer E.164 for Insomnia checkout (not AgentPhone)
 * Optional: BROWSER_USE_MODEL, BROWSER_USE_CART_TIMEOUT_MS (default 360000), BROWSER_USE_MAX_COST_USD (default 5)
 *
 * ## Run
 *   bun run repro:insomnia-bu
 *   bun run repro:insomnia-bu -- --phone +15551234567
 *   bun run repro:insomnia-bu -- --skip-graphql-seed
 *   bun run repro:insomnia-bu -- --dry-run
 */
import type { MessageResponse } from "browser-use-sdk/v3";

import { envWithDefault, requiredEnv } from "../src/env.js";
import { normalizePhone } from "../src/foodrun/customer-phone.js";
import {
  BrowserUseModule,
  buildCartPrompt,
  runCartTaskWithBlockedFallback,
} from "../src/modules/browser-use/index.js";
import { INSOMNIA_DEFAULT_BUNDLE_COUNT } from "../src/modules/insomnia-catalog-cart.js";
import {
  seedInsomniaB9G3FDeliveryCart,
  type InsomniaAddressInput,
} from "../src/modules/insomnia-graphql.js";
import type { OrderCriteria, RestaurantOption } from "../src/types.js";

const DEFAULT_ADDRESS = "560 20th St, San Francisco, CA";
const DEFAULT_POSTCODE = "94107";
const DEFAULT_BUNDLES = INSOMNIA_DEFAULT_BUNDLE_COUNT;

const DEFAULT_ADDRESS_GEO: InsomniaAddressInput = {
  address1: "560 20th St",
  city: "San Francisco",
  state: "CA",
  postcode: DEFAULT_POSTCODE,
  lat: 37.7605,
  lng: -122.3889,
};

const INSOMNIA_RESTAURANT: RestaurantOption = {
  name: "Insomnia Cookies",
  orderingUrl: "https://insomniacookies.com/checkout",
  url: "https://insomniacookies.com/",
  reason: "User requested Insomnia Cookies. FastTab will try the official site first.",
  dietaryFit: [],
};

function usage(): never {
  console.error(`Usage: bun run repro:insomnia-bu [--phone E164] [--address "…"] [--bundles N] [--dry-run] [--skip-graphql-seed] [--timeout SECONDS]

Env overrides applied by this script:
  FOODRUN_DEMO_MODE=false
  FOODRUN_INSOMNIA_CATALOG_CART=false

Requires BROWSER_USE_API_KEY and FOODRUN_DELIVERY_PHONE (or --phone).`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = argv;
  let phone: string | undefined;
  let address = DEFAULT_ADDRESS;
  let dryRun = false;
  let skipGraphqlSeed = false;
  let timeoutSeconds: number | undefined;
  let bundles = DEFAULT_BUNDLES;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--phone") {
      phone = args[++i];
    } else if (arg === "--address") {
      address = args[++i] ?? address;
    } else if (arg === "--bundles") {
      bundles = Number(args[++i]);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--skip-graphql-seed") {
      skipGraphqlSeed = true;
    } else if (arg === "--timeout") {
      timeoutSeconds = Number(args[++i]);
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
  }

  if (!Number.isFinite(bundles) || bundles < 1 || bundles > 3) {
    console.error("--bundles must be between 1 and 3.");
    process.exit(1);
  }

  return { phone, address, dryRun, skipGraphqlSeed, timeoutSeconds, bundles };
}

function reproEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    FOODRUN_DEMO_MODE: "false",
    FOODRUN_INSOMNIA_CATALOG_CART: "false",
  };
}

function buildAddress(addressLine: string): InsomniaAddressInput {
  if (/560\s+20th/i.test(addressLine)) {
    return DEFAULT_ADDRESS_GEO;
  }

  const parts = addressLine.split(",").map((part) => part.trim());
  return {
    address1: parts[0] ?? addressLine,
    city: parts[1] ?? "San Francisco",
    state: (parts[2] ?? "CA").replace(/\d{5}.*$/, "").trim() || "CA",
    postcode: addressLine.match(/\b(\d{5})\b/)?.[1] ?? DEFAULT_POSTCODE,
    lat: DEFAULT_ADDRESS_GEO.lat,
    lng: DEFAULT_ADDRESS_GEO.lng,
  };
}

function buildCriteria(address: string, deliveryPhone: string): OrderCriteria {
  return {
    roomId: "repro_insomnia_bu",
    location: { raw: address, placeName: address },
    cuisine: "Insomnia Cookies",
    pickupOrDelivery: "delivery",
    participantCount: 3,
    preferences: ["Insomnia Cookies", "Buy 9 Get 3 Free"],
    allergies: [],
    deliveryPhone,
  };
}

function cartBuildTimeoutMs(env: NodeJS.ProcessEnv): number {
  return Number(envWithDefault(env, "BROWSER_USE_CART_TIMEOUT_MS", "360000"));
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const env = reproEnv(process.env);

  const agentPhoneFallback = normalizePhone(env.AGENTPHONE_PHONE_NUMBER);
  const deliveryPhone =
    normalizePhone(cli.phone) ??
    normalizePhone(env.FOODRUN_DELIVERY_PHONE) ??
    normalizePhone(env.DELIVERY_PHONE) ??
    agentPhoneFallback ??
    "+15550000000";

  const criteria = buildCriteria(cli.address, deliveryPhone);
  const restaurant = INSOMNIA_RESTAURANT;

  if (cli.dryRun) {
    const prompt = buildCartPrompt(criteria, restaurant, {
      orderingUrl: restaurant.orderingUrl,
      discoverProviders: false,
      insomniaSeededCart: {
        orderCode: "example-order-code",
        bundleCount: cli.bundles,
        graphqlItemQuantity: cli.bundles,
        checkoutUrl: "https://insomniacookies.com/checkout",
        productUrl: "https://insomniacookies.com/products/buy-9-get-3-free-1",
      },
    });
    console.log(prompt);
    return;
  }

  if (
    !normalizePhone(cli.phone) &&
    !normalizePhone(env.FOODRUN_DELIVERY_PHONE) &&
    !normalizePhone(env.DELIVERY_PHONE) &&
    !agentPhoneFallback
  ) {
    console.error("Missing customer phone. Pass --phone or set FOODRUN_DELIVERY_PHONE in .env.local.");
    process.exit(1);
  }

  requiredEnv(env, "BROWSER_USE_API_KEY");

  const timeoutMs =
    cli.timeoutSeconds !== undefined && Number.isFinite(cli.timeoutSeconds) ?
      cli.timeoutSeconds * 1000
    : cartBuildTimeoutMs(env);
  const maxCostUsd = Number(env.BROWSER_USE_MAX_COST_USD ?? 5);

  console.error("Insomnia Browser Use repro");
  console.error(`  Address: ${cli.address}`);
  console.error(`  Phone: ${deliveryPhone}`);
  console.error(`  Bundles: ${cli.bundles}× Buy 9 Get 3 Free`);
  console.error(`  FOODRUN_DEMO_MODE=${env.FOODRUN_DEMO_MODE}`);
  console.error(`  FOODRUN_INSOMNIA_CATALOG_CART=${env.FOODRUN_INSOMNIA_CATALOG_CART}`);
  console.error(`  Timeout: ${Math.round(timeoutMs / 1000)}s  Max cost: $${maxCostUsd}`);

  let graphqlSeed:
    | {
        orderCode: string;
        graphqlItemQuantity: number;
        total?: number | null;
        items?: Array<{ quantity: number; product?: { title?: string } }>;
        checkoutUrl: string;
        productUrl: string;
      }
    | undefined;

  if (!cli.skipGraphqlSeed) {
    console.error("  Step 1: GraphQL seed cart…");
    try {
      const seeded = await seedInsomniaB9G3FDeliveryCart({
        address: buildAddress(cli.address),
        bundles: cli.bundles,
      });
      graphqlSeed = {
        orderCode: seeded.orderCode,
        graphqlItemQuantity: seeded.graphqlItemQuantity,
        total: seeded.total,
        items: seeded.items,
        checkoutUrl: seeded.checkoutUrl,
        productUrl: seeded.productUrl,
      };
      console.error(
        `  GraphQL cart: orderCode=${seeded.orderCode} qty=${seeded.graphqlItemQuantity} total=$${seeded.total ?? "?"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  GraphQL seed failed: ${message}`);
      process.exit(1);
    }
  } else {
    console.error("  Step 1: skipped (--skip-graphql-seed)");
  }

  console.error("  Step 2: Browser Use (checkout / UI add only)…");

  const browser = new BrowserUseModule(env);
  const startedAt = Date.now();

  const promptOptions =
    graphqlSeed ?
      {
        orderingUrl: graphqlSeed.checkoutUrl,
        discoverProviders: false,
        insomniaSeededCart: {
          orderCode: graphqlSeed.orderCode,
          bundleCount: cli.bundles,
          graphqlItemQuantity: graphqlSeed.graphqlItemQuantity,
          checkoutUrl: graphqlSeed.checkoutUrl,
          productUrl: graphqlSeed.productUrl,
        },
      }
    : {
        orderingUrl: "https://insomniacookies.com/products/buy-9-get-3-free-1",
        discoverProviders: false,
      };

  const result = await runCartTaskWithBlockedFallback(
    browser,
    criteria,
    restaurant,
    {
      keepAlive: true,
      maxCostUsd,
      timeoutMs,
      onMessage(message: MessageResponse) {
        if (!message.hidden && message.summary) {
          console.error(`  [BU] ${message.summary}`);
        }
      },
    },
    promptOptions,
  );

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const blockersText = result.output.blockers.join("; ");
  const recaptchaHit = /recaptcha/i.test(blockersText);

  const payload = {
    graphqlSeed: graphqlSeed ?? null,
    sessionId: result.sessionId,
    liveUrl: result.liveUrl ?? null,
    elapsedSeconds: elapsedSec,
    status: result.output.status,
    itemCount: result.output.items.length,
    blockers: result.output.blockers,
    recaptchaInBlockers: recaptchaHit,
    checkoutUrl: result.output.checkoutUrl ?? null,
    items: result.output.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  };

  console.log(JSON.stringify(payload, null, 2));

  if (result.liveUrl) {
    console.error(`\nWatch live: ${result.liveUrl}`);
  }

  if (!recaptchaHit && result.output.status === "blocked") {
    console.error(
      "\nNote: blockers did not mention reCAPTCHA this run (login/payment/cost/other). Replay live URL or re-run.",
    );
  }

  process.exit(recaptchaHit || result.output.status === "blocked" ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const sessionMatch = message.match(/Session ([0-9a-f-]+) did not complete/i);

  console.error(`repro-insomnia-bu failed: ${message}`);

  if (sessionMatch?.[1]) {
    console.error(`Hint: bun run browser:session -- ${sessionMatch[1]}`);
    console.error(`Live (if available): https://live.browser-use.com/session/${sessionMatch[1]}`);
  }

  process.exit(1);
});
