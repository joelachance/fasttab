/**
 * Minimal client for Insomnia Cookies consumer GraphQL (api.insomniacookies.com).
 * Reverse-engineered from the production web app; not a public partner API.
 *
 * Verified without login: createCart, addProductToOrderV2, addOptionsToOrderProduct
 * (one flavor per mutation), createCustomerContactOnOrder, order/shippingOptions queries,
 * generateOrderOtp.
 *
 * Blocks purchase: completeOrderV2 rejects raw PAN ("payment method not valid" / gift card
 * only on storePaymentMethods). Credit card needs processor sessionKey / hosted tokenization.
 * updateCart often 500s. No reCAPTCHA on these GraphQL calls (site Browser Use still hits CAPTCHA).
 */

import {
  INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE,
  INSOMNIA_DEFAULT_BUNDLE_COUNT,
} from "./insomnia-catalog-cart.js";

export const INSOMNIA_GRAPHQL_URL = "https://api.insomniacookies.com/graphql";

/** Downtown SF — legacy default. */
export const INSOMNIA_SF_STORE_ID = "1231";

/** SoMa/Rincon Hill — delivery to 560 20th St / 94107. */
export const INSOMNIA_SF_SOMA_STORE_ID = "2040";

/** Buy 9 Classics, Get 3 Free — productSlug buy-9-get-3-free-1 */
export const INSOMNIA_B9G3F_PRODUCT_ID = "2122";

/** Web app uses orderTypeId 2 + shippingMethod "1" for delivery. */
export const INSOMNIA_ORDER_TYPE_DELIVERY = 2;
export const INSOMNIA_SHIPPING_METHOD_DELIVERY = "1";

/** Client constant for "new credit card" in PaymentCredential. */
export const INSOMNIA_PAYMENT_METHOD_NEW_CARD = -1;

export type InsomniaAddressInput = {
  address1: string;
  city: string;
  state: string;
  postcode: string;
  lat: number;
  lng: number;
};

export type InsomniaCartContactInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type InsomniaPaymentCredentialInput = {
  paymentMethodId: number;
  saveCredentials?: boolean;
  credential?: string;
  securityCode?: string;
  paymentProcessorId?: number;
  sessionKey?: string;
  data?: {
    cardHolderName: string;
    expirationDate: string;
    postcode: string;
  };
};

export type GraphqlError = {
  message: string;
  path?: ReadonlyArray<string | number>;
  extensions?: Record<string, unknown>;
};

export type GraphqlResponse<T> = {
  data?: T;
  errors?: GraphqlError[];
  extensions?: Record<string, unknown>;
};

export type InsomniaGraphqlRequestResult<T> = {
  httpStatus: number;
  body: GraphqlResponse<T>;
  rawText: string;
};

export type InsomniaOrderSummary = {
  id?: string;
  code: string;
  subtotal?: number | null;
  total?: number | null;
  tax?: number | null;
  invoiceDate?: string | null;
  items?: Array<{
    id?: string;
    quantity: number;
    product?: { id?: string; title?: string };
    productOptions?: Array<{ id?: number; title?: string; quantity?: number }>;
  }>;
};

export type InsomniaGraphqlClientOptions = {
  endpoint?: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Default delivery store when createDeliveryCart omits storeId. */
  storeId?: string;
};

export type InsomniaFlavorPick = { optionId: number; quantity: number; title?: string };

const FLAVOR_NAME_TO_OPTION_ID: Record<string, number> = {
  "Chocolate Chunk": 4,
  "Cookies 'N Cream": 3323,
  "Classic with M&M'S": 15,
  "Vegan Chocolate Chunk": 1002,
};

function defaultHeaders(
  options: InsomniaGraphqlClientOptions,
  orderCode?: string,
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: options.origin ?? "https://insomniacookies.com",
    Referer: options.referer ?? "https://insomniacookies.com/",
    "consumer-platform": "web",
    Platform: "web",
    "User-Agent":
      options.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  if (orderCode) {
    headers["Order-Code"] = orderCode;
  }

  return headers;
}

/** 12 cookies per B9G3F bundle × bundle count, mapped to catalog flavor SKUs. */
export function flavorPicksForBundles(
  bundleCount: number = INSOMNIA_DEFAULT_BUNDLE_COUNT,
): InsomniaFlavorPick[] {
  const totalCookies = bundleCount * 12;
  const picks: InsomniaFlavorPick[] = [];
  let assigned = 0;

  for (const line of INSOMNIA_B9G3F_FLAVORS_PER_BUNDLE) {
    const optionId = FLAVOR_NAME_TO_OPTION_ID[line.name];

    if (!optionId) {
      continue;
    }

    const quantity = line.quantity * bundleCount;
    picks.push({ optionId, quantity, title: line.name });
    assigned += quantity;
  }

  if (assigned < totalCookies && picks[0]) {
    picks[0].quantity += totalCookies - assigned;
  }

  return picks;
}

export function formatInsomniaExpiration(expiration: string): string {
  const trimmed = expiration.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{2,4})$/);

  if (!match) {
    return trimmed;
  }

  const month = match[1].padStart(2, "0");
  const year = match[2].length === 4 ? match[2].slice(-2) : match[2];
  return `${month}/${year}`;
}

export function buildInsomniaPaymentCredential(input: {
  cardNumber: string;
  cvc: string;
  expiration: string;
  cardholderName?: string;
  postcode: string;
  paymentMethodId?: number;
  paymentProcessorId?: number;
}): InsomniaPaymentCredentialInput {
  return {
    paymentMethodId: input.paymentMethodId ?? INSOMNIA_PAYMENT_METHOD_NEW_CARD,
    saveCredentials: false,
    credential: input.cardNumber.replace(/\s/g, ""),
    securityCode: input.cvc,
    paymentProcessorId: input.paymentProcessorId,
    data: {
      cardHolderName: input.cardholderName?.trim() || "FastTab Guest",
      expirationDate: formatInsomniaExpiration(input.expiration),
      postcode: input.postcode,
    },
  };
}

export class InsomniaGraphqlClient {
  private readonly endpoint: string;
  private readonly options: InsomniaGraphqlClientOptions;

  constructor(options: InsomniaGraphqlClientOptions = {}) {
    this.endpoint = options.endpoint ?? INSOMNIA_GRAPHQL_URL;
    this.options = options;
  }

  async request<T>(
    query: string,
    variables?: Record<string, unknown>,
    orderCode?: string,
  ): Promise<InsomniaGraphqlRequestResult<T>> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(this.endpoint, {
      method: "POST",
      headers: defaultHeaders(this.options, orderCode),
      body: JSON.stringify({ query, variables }),
    });
    const rawText = await response.text();
    let body: GraphqlResponse<T>;

    try {
      body = JSON.parse(rawText) as GraphqlResponse<T>;
    } catch {
      throw new Error(
        `Insomnia GraphQL returned non-JSON (HTTP ${response.status}): ${rawText.slice(0, 500)}`,
      );
    }

    return { httpStatus: response.status, body, rawText };
  }

  async createDeliveryCart(input: {
    storeId?: string;
    address: InsomniaAddressInput;
    orderTypeId?: number;
    shippingMethod?: string;
  }): Promise<InsomniaGraphqlRequestResult<{ createCart: { code: string; shippingMethodMinAmount?: number } }>> {
    return this.request(
      `mutation CREATE_CART(
        $storeId: ID!
        $orderTypeId: Int!
        $shippingMethod: ID!
        $address: AddressDetailsInput
      ) {
        createCart(
          data: {
            storeId: $storeId
            orderTypeId: $orderTypeId
            shippingMethod: $shippingMethod
            address: $address
          }
        ) {
          code
          shippingMethodMinAmount
        }
      }`,
      {
        storeId: input.storeId ?? this.options.storeId ?? INSOMNIA_SF_SOMA_STORE_ID,
        orderTypeId: input.orderTypeId ?? INSOMNIA_ORDER_TYPE_DELIVERY,
        shippingMethod: input.shippingMethod ?? INSOMNIA_SHIPPING_METHOD_DELIVERY,
        address: input.address,
      },
    );
  }

  async addProductToOrder(input: {
    orderCode: string;
    productId: string;
    quantity: number;
    platform?: string;
  }): Promise<InsomniaGraphqlRequestResult<{ addProductToOrderV2: { __typename: string } }>> {
    return this.request(
      `mutation ADD_PRODUCT($orderCode: String!, $data: OrderProductInput!) {
        addProductToOrderV2(orderCode: $orderCode, data: $data) {
          __typename
        }
      }`,
      {
        orderCode: input.orderCode,
        data: {
          product: input.productId,
          quantity: input.quantity,
          platform: input.platform ?? "web",
        },
      },
      input.orderCode,
    );
  }

  async addFlavorOptions(input: {
    orderCode: string;
    productId: string;
    orderItemId: string;
    flavors: InsomniaFlavorPick[];
  }): Promise<InsomniaGraphqlRequestResult<{ addOptionsToOrderProduct: { __typename: string } }>> {
    let last: InsomniaGraphqlRequestResult<{ addOptionsToOrderProduct: { __typename: string } }> | undefined;

    for (const flavor of input.flavors) {
      last = await this.request(
        `mutation ADD_OPTIONS(
          $orderCode: String!
          $productId: Int!
          $orderProductId: Int!
          $options: [ProductOptionInput!]!
        ) {
          addOptionsToOrderProduct(
            orderCode: $orderCode
            productId: $productId
            orderProductId: $orderProductId
            options: $options
          ) {
            __typename
          }
        }`,
        {
          orderCode: input.orderCode,
          productId: Number.parseInt(input.productId, 10),
          orderProductId: Number.parseInt(input.orderItemId, 10),
          options: [{ optionId: flavor.optionId, quantity: flavor.quantity }],
        },
        input.orderCode,
      );

      const error = firstGraphqlErrorMessage(last.body);

      if (error) {
        throw new Error(`addOptionsToOrderProduct (${flavor.title ?? flavor.optionId}): ${error}`);
      }
    }

    if (!last) {
      throw new Error("addFlavorOptions: no flavors");
    }

    return last;
  }

  async shippingOptions(input: {
    orderCode: string;
    zipcode: string;
  }): Promise<
    InsomniaGraphqlRequestResult<{
      shippingOptions: Array<{ shippingMethodId: string; class?: string; cost?: number }>;
    }>
  > {
    return this.request(
      `query SHIPPING($orderCode: String!, $zipcode: String!) {
        shippingOptions(orderCode: $orderCode, zipcode: $zipcode) {
          shippingMethodId
          class
          cost
        }
      }`,
      { orderCode: input.orderCode, zipcode: input.zipcode },
      input.orderCode,
    );
  }

  async createCustomerContactOnOrder(input: {
    orderCode: string;
    contact: InsomniaCartContactInput;
  }): Promise<InsomniaGraphqlRequestResult<{ createCustomerContactOnOrder: { __typename: string } }>> {
    return this.request(
      `mutation SET_CONTACT($orderCode: String!, $data: CartContactInput!) {
        createCustomerContactOnOrder(orderCode: $orderCode, data: $data) {
          __typename
        }
      }`,
      {
        orderCode: input.orderCode,
        data: input.contact,
      },
      input.orderCode,
    );
  }

  async getOrder(orderCode: string): Promise<
    InsomniaGraphqlRequestResult<{ order: InsomniaOrderSummary }>
  > {
    return this.request(
      `query ORDER($orderCode: String!) {
        order(orderCode: $orderCode) {
          id
          code
          subtotal
          total
          tax
          invoiceDate
          items {
            id
            quantity
            product {
              id
              title
            }
            productOptions {
              id
              title
              quantity
            }
          }
        }
      }`,
      { orderCode },
      orderCode,
    );
  }

  async completeOrderV2(input: {
    orderCode: string;
    contact: InsomniaCartContactInput;
    paymentCredential?: InsomniaPaymentCredentialInput;
    orderOtp?: string;
  }): Promise<InsomniaGraphqlRequestResult<{ completeOrderV2: boolean }>> {
    return this.request(
      `mutation COMPLETE(
        $orderCode: String!
        $contact: CartContactInput!
        $paymentCredential: PaymentCredential
        $orderOtp: String
      ) {
        completeOrderV2(
          orderCode: $orderCode
          contact: $contact
          paymentCredential: $paymentCredential
          orderOtp: $orderOtp
        )
      }`,
      {
        orderCode: input.orderCode,
        contact: input.contact,
        paymentCredential: input.paymentCredential,
        orderOtp: input.orderOtp,
      },
      input.orderCode,
    );
  }

  async generateOrderOtp(orderCode: string): Promise<
    InsomniaGraphqlRequestResult<{ generateOrderOtp: boolean }>
  > {
    return this.request(
      `mutation OTP($orderCode: String!) {
        generateOrderOtp(orderCode: $orderCode)
      }`,
      { orderCode },
      orderCode,
    );
  }
}

export { INSOMNIA_DEFAULT_BUNDLE_COUNT };

export const INSOMNIA_CHECKOUT_URL = "https://insomniacookies.com/checkout";
export const INSOMNIA_B9G3F_PRODUCT_PATH = "/products/buy-9-get-3-free-1";

export type InsomniaSeededCartResult = {
  orderCode: string;
  orderId?: string;
  bundleCount: number;
  /** Sum of line-item quantities from GraphQL order query. */
  graphqlItemQuantity: number;
  total?: number | null;
  items?: InsomniaOrderSummary["items"];
  checkoutUrl: string;
  productUrl: string;
};

export function insomniaCheckoutUrls(orderCode: string): { checkoutUrl: string; productUrl: string } {
  return {
    checkoutUrl: INSOMNIA_CHECKOUT_URL,
    productUrl: `https://insomniacookies.com${INSOMNIA_B9G3F_PRODUCT_PATH}`,
  };
}

/** Delivery cart with B9G3F bundles + flavor options (no payment). */
export async function seedInsomniaB9G3FDeliveryCart(input: {
  client?: InsomniaGraphqlClient;
  address: InsomniaAddressInput;
  bundles?: number;
  contact?: InsomniaCartContactInput;
  configureFlavors?: boolean;
}): Promise<InsomniaSeededCartResult> {
  const bundles = input.bundles ?? INSOMNIA_DEFAULT_BUNDLE_COUNT;
  const client = input.client ?? new InsomniaGraphqlClient();
  const configureFlavors = input.configureFlavors ?? true;

  const createResult = await client.createDeliveryCart({ address: input.address });
  const createError = firstGraphqlErrorMessage(createResult.body);

  if (createError) {
    throw new Error(`createCart: ${createError}`);
  }

  const orderCode = createResult.body.data?.createCart.code;

  if (!orderCode) {
    throw new Error("createCart: missing order code");
  }

  const addResult = await client.addProductToOrder({
    orderCode,
    productId: INSOMNIA_B9G3F_PRODUCT_ID,
    quantity: bundles,
  });
  const addError = firstGraphqlErrorMessage(addResult.body);

  if (addError) {
    throw new Error(`addProductToOrderV2: ${addError}`);
  }

  if (input.contact) {
    const contactResult = await client.createCustomerContactOnOrder({
      orderCode,
      contact: input.contact,
    });
    const contactError = firstGraphqlErrorMessage(contactResult.body);

    if (contactError) {
      throw new Error(`createCustomerContactOnOrder: ${contactError}`);
    }
  }

  let orderResult = await client.getOrder(orderCode);
  let order = orderResult.body.data?.order;
  const lineItemId = order?.items?.[0]?.id;

  if (configureFlavors && lineItemId) {
    await client.addFlavorOptions({
      orderCode,
      productId: INSOMNIA_B9G3F_PRODUCT_ID,
      orderItemId: lineItemId,
      flavors: flavorPicksForBundles(bundles),
    });
    orderResult = await client.getOrder(orderCode);
    order = orderResult.body.data?.order;
  }

  const graphqlItemQuantity =
    order?.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0;
  const urls = insomniaCheckoutUrls(orderCode);

  return {
    orderCode,
    orderId: order?.id,
    bundleCount: bundles,
    graphqlItemQuantity,
    total: order?.total,
    items: order?.items,
    checkoutUrl: urls.checkoutUrl,
    productUrl: urls.productUrl,
  };
}

export function graphqlErrors(body: GraphqlResponse<unknown>): GraphqlError[] {
  return body.errors ?? [];
}

export function firstGraphqlErrorMessage(body: GraphqlResponse<unknown>): string | undefined {
  return graphqlErrors(body)[0]?.message;
}
