/**
 * Place an Insomnia Cookies order via api.insomniacookies.com/graphql (no Browser Use).
 *
 * Usage:
 *   bun run order:insomnia-graphql
 *   bun run order:insomnia-graphql -- --phone +16515008226 --bundles 2
 *   bun run order:insomnia-graphql -- --skip-payment   # cart + contact only
 *
 * Env (.env.local): FOODRUN_DELIVERY_PHONE, FOODRUN_ORDER_EMAIL, SPONGE_API_KEY (for payment attempt)
 */
import { envWithDefault, envWithDotenvLocalOverrides } from "../src/env.js";
import { checkoutPaymentCardFromSponge } from "../src/foodrun/job-worker.js";
import { normalizePhone } from "../src/foodrun/customer-phone.js";
import {
  buildInsomniaPaymentCredential,
  firstGraphqlErrorMessage,
  graphqlErrors,
  flavorPicksForBundles,
  INSOMNIA_B9G3F_PRODUCT_ID,
  InsomniaGraphqlClient,
  type InsomniaAddressInput,
  type InsomniaCartContactInput,
} from "../src/modules/insomnia-graphql.js";
import { INSOMNIA_B9G3F_DEAL_NAME, INSOMNIA_DEFAULT_BUNDLE_COUNT as DEFAULT_BUNDLES } from "../src/modules/insomnia-catalog-cart.js";
import { lastFour, SpongeModule } from "../src/modules/sponge/index.js";

const DEFAULT_ADDRESS = "560 20th St, San Francisco, CA";
const DEFAULT_ORDER_EMAIL = "satori@agentmail.to";
const DEFAULT_POSTCODE = "94107";

/** Approximate geocode for 560 20th St, San Francisco (delivery createCart). */
const DEFAULT_ADDRESS_GEO: InsomniaAddressInput = {
  address1: "560 20th St",
  city: "San Francisco",
  state: "CA",
  postcode: DEFAULT_POSTCODE,
  lat: 37.7605,
  lng: -122.3889,
};

type CliOptions = {
  phone?: string;
  email: string;
  addressLine: string;
  bundles: number;
  skipPayment: boolean;
};

type StepRecord = {
  step: string;
  httpStatus: number;
  ok: boolean;
  data?: unknown;
  errors?: unknown;
  rawText?: string;
};

function usage(): never {
  console.error(`Usage: bun run order:insomnia-graphql [--phone E164] [--email ADDR] [--address "…"] [--bundles N] [--skip-payment]

  --phone         Customer phone (default FOODRUN_DELIVERY_PHONE or +16515008226)
  --email         Checkout email (default FOODRUN_ORDER_EMAIL or ${DEFAULT_ORDER_EMAIL})
  --address       Delivery street line (default 560 20th St, San Francisco, CA)
  --bundles       Buy 9 Get 3 Free bundle count (1–3 per cart line; default ${DEFAULT_BUNDLES})
  --skip-payment  Build cart + contact only; do not call completeOrderV2
`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  let phone: string | undefined;
  let email: string | undefined;
  let addressLine = DEFAULT_ADDRESS;
  let bundles = DEFAULT_BUNDLES;
  let skipPayment = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--phone") {
      phone = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === "--email") {
      email = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === "--address") {
      addressLine = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === "--bundles") {
      bundles = Number(argv[index + 1] ?? usage());
      index += 1;
      continue;
    }
    if (arg === "--skip-payment") {
      skipPayment = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
    }

    console.error(`Unknown argument: ${arg}`);
    usage();
  }

  if (!Number.isFinite(bundles) || bundles < 1 || bundles > 3) {
    console.error("--bundles must be between 1 and 3 (API max quantity per B9G3F line).");
    process.exit(1);
  }

  return {
    phone,
    email: email ?? envWithDefault(process.env, "FOODRUN_ORDER_EMAIL", DEFAULT_ORDER_EMAIL),
    addressLine,
    bundles,
    skipPayment,
  };
}

function resolvePhone(cli: CliOptions, env: NodeJS.ProcessEnv): string {
  const normalized =
    normalizePhone(cli.phone) ??
    normalizePhone(env.FOODRUN_DELIVERY_PHONE) ??
    normalizePhone("+16515008226");

  if (!normalized) {
    console.error("Missing phone. Pass --phone or set FOODRUN_DELIVERY_PHONE.");
    process.exit(1);
  }

  return normalized;
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

function buildContact(cli: CliOptions, phone: string): InsomniaCartContactInput {
  return {
    firstName: "Satori",
    lastName: "Agent",
    email: cli.email,
    phone,
  };
}

function recordStep(
  steps: StepRecord[],
  step: string,
  result: { httpStatus: number; body: unknown; rawText: string },
): boolean {
  const errors = (result.body as { errors?: unknown }).errors;
  const ok = !errors || (Array.isArray(errors) && errors.length === 0);
  steps.push({
    step,
    httpStatus: result.httpStatus,
    ok,
    data: (result.body as { data?: unknown }).data,
    errors,
    rawText: result.rawText,
  });
  return ok;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const env = envWithDotenvLocalOverrides();
  const phone = resolvePhone(cli, env);
  const contact = buildContact(cli, phone);
  const address = buildAddress(cli.addressLine);
  const client = new InsomniaGraphqlClient();
  const steps: StepRecord[] = [];

  console.error(
    `Insomnia GraphQL order: ${cli.bundles}× ${INSOMNIA_B9G3F_DEAL_NAME} (product ${INSOMNIA_B9G3F_PRODUCT_ID}) → ${cli.addressLine}`,
  );
  console.error(`  Phone: ${phone}  Email: ${cli.email}`);

  const createResult = await client.createDeliveryCart({ address });
  if (!recordStep(steps, "createCart", createResult)) {
    const output = {
      success: false,
      stage: "createCart",
      steps,
      error: firstGraphqlErrorMessage(createResult.body),
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }

  const orderCode = createResult.body.data?.createCart.code;

  if (!orderCode) {
    console.log(JSON.stringify({ success: false, stage: "createCart", steps, error: "No cart code" }, null, 2));
    process.exit(1);
  }

  const addResult = await client.addProductToOrder({
    orderCode,
    productId: INSOMNIA_B9G3F_PRODUCT_ID,
    quantity: cli.bundles,
  });
  if (!recordStep(steps, "addProductToOrderV2", addResult)) {
    console.log(
      JSON.stringify(
        {
          success: false,
          stage: "addProductToOrderV2",
          orderCode,
          steps,
          error: firstGraphqlErrorMessage(addResult.body),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const contactResult = await client.createCustomerContactOnOrder({ orderCode, contact });
  recordStep(steps, "createCustomerContactOnOrder", contactResult);

  let orderResult = await client.getOrder(orderCode);
  recordStep(steps, "order", orderResult);
  let order = orderResult.body.data?.order;

  const lineItemId = order?.items?.[0]?.id;

  if (lineItemId) {
    try {
      const flavors = flavorPicksForBundles(cli.bundles);
      const flavorResult = await client.addFlavorOptions({
        orderCode,
        productId: INSOMNIA_B9G3F_PRODUCT_ID,
        orderItemId: lineItemId,
        flavors,
      });
      recordStep(steps, "addOptionsToOrderProduct", flavorResult);
      orderResult = await client.getOrder(orderCode);
      recordStep(steps, "orderAfterFlavors", orderResult);
      order = orderResult.body.data?.order;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ step: "addOptionsToOrderProduct", httpStatus: 0, ok: false, errors: message });
    }
  } else {
    steps.push({
      step: "addOptionsToOrderProduct",
      httpStatus: 0,
      ok: false,
      errors: "No order line item id — B9G3F flavors not configured",
    });
  }

  const shippingResult = await client.shippingOptions({
    orderCode,
    zipcode: address.postcode,
  });
  recordStep(steps, "shippingOptions", shippingResult);

  if (cli.skipPayment) {
    console.log(
      JSON.stringify(
        {
          success: true,
          stage: "cart_ready",
          orderCode,
          orderId: order?.id,
          total: order?.total,
          items: order?.items,
          steps,
          note: "Payment skipped (--skip-payment).",
        },
        null,
        2,
      ),
    );
    return;
  }

  let paymentCredential: ReturnType<typeof buildInsomniaPaymentCredential> | undefined;
  let paymentLast4: string | undefined;

  try {
    const sponge = new SpongeModule(env);
    const card = await sponge.fetchCheckoutCard(env);
    const pay = checkoutPaymentCardFromSponge(card);
    paymentLast4 = lastFour(pay.cardNumber);
    paymentCredential = buildInsomniaPaymentCredential({
      cardNumber: pay.cardNumber,
      cvc: pay.cvc,
      expiration: pay.expiration,
      cardholderName: pay.cardholderName,
      postcode: address.postcode,
    });
    console.error(`  Sponge card: ****${paymentLast4 ?? "????"} exp ${paymentCredential.data?.expirationDate}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify(
        {
          success: false,
          stage: "sponge_card",
          orderCode,
          orderId: order?.id,
          total: order?.total,
          steps,
          hardBlocker: `Could not load Sponge checkout card: ${message}`,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const completeResult = await client.completeOrderV2({
    orderCode,
    contact,
    paymentCredential,
  });
  const completeOk = recordStep(steps, "completeOrderV2", completeResult);
  const completeErrors = graphqlErrors(completeResult.body);

  if (completeOk && completeResult.body.data?.completeOrderV2 === true) {
    const confirmResult = await client.getOrder(orderCode);
    recordStep(steps, "orderAfterComplete", confirmResult);
    const confirmed = confirmResult.body.data?.order;

    console.log(
      JSON.stringify(
        {
          success: true,
          stage: "complete",
          orderCode,
          orderId: confirmed?.id ?? order?.id,
          invoiceDate: confirmed?.invoiceDate,
          total: confirmed?.total ?? order?.total,
          paymentLast4,
          steps,
        },
        null,
        2,
      ),
    );
    console.error(`Order placed. orderId=${confirmed?.id ?? order?.id} code=${orderCode}`);
    return;
  }

  const otpHint = completeErrors.some((error) =>
    /otp/i.test(error.message ?? ""),
  );

  if (otpHint) {
    const otpResult = await client.generateOrderOtp(orderCode);
    recordStep(steps, "generateOrderOtp", otpResult);
  }

  const confirmAfterFail = await client.getOrder(orderCode);
  recordStep(steps, "orderAfterPaymentFailure", confirmAfterFail);

  console.log(
    JSON.stringify(
      {
        success: false,
        stage: "completeOrderV2",
        orderCode,
        orderId: order?.id,
        total: order?.total,
        items: order?.items,
        paymentLast4,
        hardBlocker:
          "Cart and contact succeeded; payment rejected. Insomnia only exposes Gift Card in storePaymentMethods for SF; credit card uses paymentMethodId -1 and requires processor tokenization (sessionKey), not raw PAN.",
        graphqlErrors: completeErrors,
        steps,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`order-insomnia-graphql failed: ${message}`);
  process.exit(1);
});
