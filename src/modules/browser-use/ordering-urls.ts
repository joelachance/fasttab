import type { OrderCriteria, RestaurantOption } from "../../types.js";

export type OrderingProvider =
  | "toast"
  | "square"
  | "chownow"
  | "bentobox"
  | "shopify"
  | "blizzfull"
  | "marketplace"
  | "unknown";

const MARKETPLACE_HOST =
  /doordash\.com|ubereats\.com|grubhub\.com|postmates\.com|seamless\.com/i;

const MARKETPLACE_ONLY_BRAND_PATTERN =
  /\bcrumbl cookies?\b/i;

const INSOMNIA_BRAND_PATTERN = /\binsomnia cookies?\b|\binsomnia\b.*\bcookies?\b/i;

const MARKETPLACE_PREFERENCE_PATTERN =
  /\b(grubhub|doordash|door dash|uber eats|uber\s*eats|delivery app|delivery marketplace)\b/i;

const DIRECT_ORDERING_HOST_PATTERN = /insomniacookies\.com/i;

const PROVIDER_HOST: Array<[OrderingProvider, RegExp]> = [
  ["toast", /toasttab\.com|order\.toasttab/i],
  ["square", /square\.site|squareup\.com/i],
  ["chownow", /chownow\.com/i],
  ["bentobox", /bentobox\.com|getbento\.com/i],
  ["shopify", /myshopify\.com|shopify\.com/i],
  ["blizzfull", /blizzfull\.com/i],
];

export function hasOfficialDirectOrdering(restaurant: RestaurantOption): boolean {
  if (buildOrderingUrlAttempts(restaurant).some((url) => DIRECT_ORDERING_HOST_PATTERN.test(url))) {
    return true;
  }

  return INSOMNIA_BRAND_PATTERN.test(restaurant.name);
}

export function detectOrderingProvider(url: string): OrderingProvider {
  if (MARKETPLACE_HOST.test(url)) {
    return "marketplace";
  }

  for (const [provider, pattern] of PROVIDER_HOST) {
    if (pattern.test(url)) {
      return provider;
    }
  }

  return "unknown";
}

export function buildOrderingUrlAttempts(restaurant: RestaurantOption): string[] {
  const urls: string[] = [];
  const add = (value?: string) => {
    if (!value?.trim()) {
      return;
    }

    try {
      const normalized = new URL(value.trim()).toString();

      if (!urls.includes(normalized)) {
        urls.push(normalized);
      }
    } catch {
      // Ignore invalid URLs.
    }
  };

  add(restaurant.orderingUrl);
  add(restaurant.url);

  const prioritized = urls.sort((left, right) => providerPriority(left) - providerPriority(right));

  return prioritized;
}

function providerPriority(url: string): number {
  const provider = detectOrderingProvider(url);

  switch (provider) {
    case "toast":
      return 0;
    case "square":
      return 1;
    case "chownow":
      return 2;
    case "bentobox":
      return 3;
    case "shopify":
      return 4;
    case "unknown":
      return 5;
    case "blizzfull":
      return 6;
    case "marketplace":
      return 7;
    default:
      return 8;
  }
}

export function shouldDiscoverOrderingProviders(restaurant: RestaurantOption): boolean {
  const urls = buildOrderingUrlAttempts(restaurant);

  if (urls.length === 0) {
    return true;
  }

  return urls.every((url) => {
    const provider = detectOrderingProvider(url);

    return provider === "blizzfull" || provider === "unknown";
  });
}

export function prefersMarketplaceOrdering(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): boolean {
  const haystack = [
    criteria.cuisine ?? "",
    restaurant.name,
    restaurant.reason,
    ...criteria.preferences,
  ]
    .join(" ")
    .toLowerCase();

  if (hasOfficialDirectOrdering(restaurant)) {
    return MARKETPLACE_PREFERENCE_PATTERN.test(haystack);
  }

  return (
    MARKETPLACE_ONLY_BRAND_PATTERN.test(haystack) || MARKETPLACE_PREFERENCE_PATTERN.test(haystack)
  );
}

export function shouldTryMarketplaceOrdering(
  criteria: OrderCriteria,
  restaurant: RestaurantOption,
): boolean {
  if (prefersMarketplaceOrdering(criteria, restaurant)) {
    return true;
  }

  const urls = buildOrderingUrlAttempts(restaurant);

  return urls.length === 0 || urls.every((url) => detectOrderingProvider(url) === "marketplace");
}

export function marketplaceOrderingHint(criteria: OrderCriteria, restaurant: RestaurantOption): string {
  const location = criteria.location.placeName ?? criteria.location.raw;

  return `Search Grubhub and DoorDash for "${restaurant.name}" near ${location}. Use the listing that matches this restaurant and supports ${criteria.pickupOrDelivery} if possible.`;
}
