/**
 * Build an Insomnia Cookies catalog cart (FOODRUN_INSOMNIA_CATALOG_CART) without Browser Use.
 *
 * Usage:
 *   bun run order:insomnia-catalog
 *   bun run order:insomnia-catalog -- --phone +15551234567
 *   bun run order:insomnia-catalog -- --address "560 20th St, San Francisco, CA"
 *   bun run order:insomnia-catalog -- --preset default
 *   bun run order:insomnia-catalog -- --preset rotate --items 6
 *   bun run order:insomnia-catalog -- --sponge
 *
 * Env (.env.local via env helpers):
 *   FOODRUN_INSOMNIA_CATALOG_CART — set false to disable catalog path (default true)
 *   FOODRUN_DELIVERY_PHONE — customer E.164 when --phone is omitted
 *   SPONGE_API_KEY, SPONGE_AGENT_ID, … — required for --sponge (see sponge:fetch-card)
 *
 * Complete payment manually:
 *   1. Open the checkout URL (insomniacookies.com).
 *   2. Start delivery to the address in the cart notes; enter the customer phone at checkout.
 *   3. Add cookies matching the printed line items (names and quantities).
 *   4. Pay with your Sponge virtual card: run with --sponge or `bun run sponge:fetch-card`
 *      for masked PAN/expiry and limits; enter full card details on the Insomnia checkout form.
 */
import { SpongePlatform } from "@paysponge/sdk";

import { envWithDefault, envWithDotenvLocalOverrides, requiredEnv } from "../src/env.js";
import { normalizePhone } from "../src/foodrun/customer-phone.js";
import {
  buildCartFromLineItems,
  buildInsomniaCatalogCart,
  INSOMNIA_DEFAULT_LINE_ITEMS,
  insomniaCatalogCartEnabled,
  INSOMNIA_CATALOG_CART_NOTE,
} from "../src/modules/insomnia-catalog-cart.js";
import {
  formatExpiry,
  lastFour,
  maskPan,
  SpongeModule,
  type FoodOrderCard,
} from "../src/modules/sponge/index.js";
import type { CartSummary, OrderCriteria, RestaurantOption } from "../src/types.js";

const DEFAULT_ADDRESS = "560 20th St, San Francisco, CA";
const DEFAULT_ROTATE_ITEM_COUNT = 3;
const INSOMNIA_RESTAURANT: RestaurantOption = {
  name: "Insomnia Cookies",
  orderingUrl: "https://insomniacookies.com/",
  url: "https://insomniacookies.com/",
  reason: "Insomnia catalog order script",
  dietaryFit: [],
};

const SPONGE_AGENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Preset = "default" | "rotate";

type CliOptions = {
  phone?: string;
  address: string;
  preset: Preset;
  rotateItems: number;
  sponge: boolean;
};

function usage(): never {
  console.error(`Usage: bun run order:insomnia-catalog [--phone E164] [--address "…"] [--preset default|rotate] [--items N] [--sponge]

  --phone     Customer delivery phone (E.164). Default: FOODRUN_DELIVERY_PHONE from .env.local
  --address   Delivery address. Default: ${DEFAULT_ADDRESS}
  --preset    default: 4 SKUs × 3 each (12 cookies). rotate: cycle menu SKUs (see --items)
  --items     Cookie line count for rotate preset only (1–12). Default: ${DEFAULT_ROTATE_ITEM_COUNT}
  --sponge    Fetch Sponge checkout card from .env.local and include masked card details
`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  let phone: string | undefined;
  let address = DEFAULT_ADDRESS;
  let preset: Preset = "default";
  let rotateItems = DEFAULT_ROTATE_ITEM_COUNT;
  let sponge = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--phone") {
      phone = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === "--address") {
      address = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === "--preset") {
      const raw = argv[index + 1] ?? usage();
      if (raw !== "default" && raw !== "rotate") {
        console.error("--preset must be default or rotate");
        usage();
      }
      preset = raw;
      index += 1;
      continue;
    }
    if (arg === "--items") {
      const raw = argv[index + 1] ?? usage();
      rotateItems = Number.parseInt(raw, 10);
      if (!Number.isFinite(rotateItems) || rotateItems < 1 || rotateItems > 12) {
        console.error("--items must be an integer from 1 to 12");
        usage();
      }
      index += 1;
      continue;
    }
    if (arg === "--sponge") {
      sponge = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
    }
    if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
  }

  return { phone, address, preset, rotateItems, sponge };
}

async function resolveSpongeAgentId(env: NodeJS.ProcessEnv): Promise<void> {
  const apiKey = requiredEnv(env, "SPONGE_API_KEY");

  if (!apiKey.startsWith("sponge_master")) {
    return;
  }

  const raw = env.SPONGE_AGENT_ID?.trim();

  if (raw && SPONGE_AGENT_UUID_RE.test(raw)) {
    return;
  }

  const agentName = raw || envWithDefault(env, "SPONGE_AGENT_NAME", "Fasttab Foodrun Agent");
  const baseUrl = envWithDefault(env, "SPONGE_API_BASE", "https://api.wallet.paysponge.com");
  const platform = await SpongePlatform.connect({ apiKey, baseUrl });
  const agents = await platform.listAgents();
  const match = agents.find((agent) => agent.name === agentName || agent.id === agentName);

  if (!match) {
    throw new Error(
      `No Sponge agent named "${agentName}". Set SPONGE_AGENT_ID in .env.local or create the agent in the Sponge dashboard.`,
    );
  }

  env.SPONGE_AGENT_ID = match.id;
  console.error(`Using Sponge agent "${match.name}" (${match.id}).`);
}

function formatUsd(cents: number | undefined): string | undefined {
  if (cents === undefined) {
    return undefined;
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function lineItemsFromCart(cart: CartSummary) {
  return cart.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.price?.cents,
    unitPriceUsd: formatUsd(item.price?.cents),
    lineTotalCents: (item.price?.cents ?? 0) * item.quantity,
    lineTotalUsd: formatUsd((item.price?.cents ?? 0) * item.quantity),
    notes: item.notes,
  }));
}

function maskedSpongeCard(card: FoodOrderCard) {
  const panSource =
    card.cardNumber && card.cardNumber.replace(/\D/g, "").length > 4 ? card.cardNumber : undefined;

  return {
    cardId: card.cardId,
    paymentMethodId: card.paymentMethodId,
    panMasked: maskPan(panSource) ?? (card.cardNumber && card.cardNumber.length <= 8 ? card.cardNumber : undefined),
    last4: lastFour(panSource) ?? (card.cardNumber?.length === 4 ? card.cardNumber : undefined),
    expiry: formatExpiry(card),
    cardholderName: card.cardholderName,
    status: card.status,
    amountUsd: card.amountUsd,
    limitUsd: card.limitUsd,
    merchantName: card.merchantName,
    merchantUrl: card.merchantUrl,
    paymentInstructions: [
      "Open checkoutUrl and complete delivery checkout on insomniacookies.com.",
      "Enter the full virtual card number, expiry, and CVC from Sponge (bun run sponge:fetch-card if not shown here).",
      "Use the delivery address and customer phone from cart line item notes.",
    ],
  };
}

function buildCriteria(options: CliOptions, env: NodeJS.ProcessEnv): OrderCriteria {
  const deliveryPhone =
    normalizePhone(options.phone) ??
    normalizePhone(env.FOODRUN_DELIVERY_PHONE) ??
    normalizePhone(env.DELIVERY_PHONE);

  if (!deliveryPhone) {
    console.error("Missing customer phone. Pass --phone or set FOODRUN_DELIVERY_PHONE in .env.local.");
    process.exit(1);
  }

  const participantCount =
    options.preset === "default" ?
      INSOMNIA_DEFAULT_LINE_ITEMS.reduce((sum, line) => sum + line.quantity, 0)
    : options.rotateItems;

  return {
    roomId: "insomnia_catalog_cli",
    location: {
      raw: options.address,
      placeName: options.address,
    },
    cuisine: "Insomnia Cookies",
    pickupOrDelivery: "delivery",
    participantCount,
    preferences: ["Insomnia Cookies"],
    allergies: [],
    deliveryPhone,
  };
}

function buildCart(criteria: OrderCriteria, options: CliOptions): CartSummary {
  if (options.preset === "default") {
    return buildCartFromLineItems(criteria, INSOMNIA_RESTAURANT, INSOMNIA_DEFAULT_LINE_ITEMS);
  }

  return buildInsomniaCatalogCart(criteria, INSOMNIA_RESTAURANT);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const env = envWithDotenvLocalOverrides();

  if (!insomniaCatalogCartEnabled(env)) {
    console.error("FOODRUN_INSOMNIA_CATALOG_CART is false; catalog cart path is disabled.");
    process.exit(1);
  }

  const criteria = buildCriteria(cli, env);
  const cart = buildCart(criteria, cli);
  const lineItems = lineItemsFromCart(cart);
  const totalCents = cart.estimatedTotal?.cents ?? cart.subtotal?.cents;
  const cookieCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  let spongeCard: ReturnType<typeof maskedSpongeCard> | undefined;

  if (cli.sponge) {
    if (!env.SPONGE_API_KEY?.trim()) {
      console.error("Missing SPONGE_API_KEY. Set it in .env.local or omit --sponge.");
      process.exit(1);
    }

    await resolveSpongeAgentId(env);
    const sponge = new SpongeModule(env);
    const card = await sponge.fetchCheckoutCard(env);
    spongeCard = maskedSpongeCard(card);
    console.error("Sponge checkout card fetched (masked below).");
  }

  const payload = {
    catalogNote: INSOMNIA_CATALOG_CART_NOTE,
    preset: cli.preset,
    deliveryAddress: criteria.location.placeName ?? criteria.location.raw,
    deliveryPhone: criteria.deliveryPhone,
    checkoutUrl: cart.checkoutUrl,
    restaurantName: cart.restaurantName,
    lineItems,
    subtotalCents: cart.subtotal?.cents,
    subtotalUsd: formatUsd(cart.subtotal?.cents),
    totalCents,
    totalUsd: formatUsd(totalCents),
    cart,
    spongeCard,
  };

  console.log(JSON.stringify(payload, null, 2));

  console.error("");
  console.error("Insomnia catalog cart ready");
  console.error(`  Preset: ${cli.preset}`);
  console.error(`  Checkout: ${cart.checkoutUrl}`);
  console.error(`  Deliver to: ${payload.deliveryAddress}`);
  console.error(`  Phone: ${payload.deliveryPhone}`);
  console.error(`  Items: ${cookieCount} cookies (${lineItems.length} SKUs), total ${payload.totalUsd ?? "n/a"}`);
  for (const item of lineItems) {
    console.error(`    - ${item.quantity}x ${item.name} @ ${item.unitPriceUsd ?? "?"}`);
  }
  console.error("");
  console.error("To pay: open checkout URL, add matching cookies for delivery, checkout with Sponge card.");
  if (!cli.sponge) {
    console.error("  Tip: re-run with --sponge or `bun run sponge:fetch-card` for card details.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`order-insomnia-catalog failed: ${message}`);
  process.exit(1);
});
