import type { Env } from "../env.js";
import type { OrderCriteria, RestaurantOption } from "../types.js";

export type RestaurantAvailabilitySource = "google_places" | "yelp";

export type RestaurantAvailabilityCandidate = RestaurantOption & {
  source: RestaurantAvailabilitySource;
  openNow?: boolean;
};

export type RestaurantAvailabilityFetch = typeof fetch;

export class RestaurantAvailabilityModule {
  constructor(
    private readonly env: Env = process.env,
    private readonly fetchImpl: RestaurantAvailabilityFetch = fetch,
  ) {}

  async findCandidates(criteria: OrderCriteria): Promise<RestaurantAvailabilityCandidate[]> {
    const [google, yelp] = await Promise.all([
      this.googlePlacesCandidates(criteria),
      this.yelpCandidates(criteria),
    ]);

    return dedupeCandidates([...google, ...yelp]).slice(0, 8);
  }

  private async googlePlacesCandidates(
    criteria: OrderCriteria,
  ): Promise<RestaurantAvailabilityCandidate[]> {
    const apiKey = this.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return [];
    }

    const response = await this.fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.displayName",
          "places.formattedAddress",
          "places.websiteUri",
          "places.googleMapsUri",
          "places.currentOpeningHours.openNow",
          "places.priceLevel",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: `${criteria.cuisine ?? ""} restaurant ${criteria.location.placeName ?? criteria.location.raw}`.trim(),
        openNow: true,
        maxResultCount: 8,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Places availability search failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      places?: Array<{
        displayName?: { text?: string };
        formattedAddress?: string;
        websiteUri?: string;
        googleMapsUri?: string;
        currentOpeningHours?: { openNow?: boolean };
      }>;
    };

    return (body.places ?? [])
      .filter((place) => place.currentOpeningHours?.openNow !== false)
      .map((place) => ({
        source: "google_places" as const,
        name: place.displayName?.text ?? "Unknown restaurant",
        url: place.websiteUri ?? place.googleMapsUri,
        orderingUrl: place.websiteUri,
        address: place.formattedAddress,
        reason: "Open now per Google Places. Browser Use must verify online ordering and cartability.",
        dietaryFit: [],
        openNow: place.currentOpeningHours?.openNow,
      }))
      .filter((candidate) => candidate.name !== "Unknown restaurant");
  }

  private async yelpCandidates(criteria: OrderCriteria): Promise<RestaurantAvailabilityCandidate[]> {
    const apiKey = this.env.YELP_API_KEY;

    if (!apiKey) {
      return [];
    }

    const params = new URLSearchParams({
      term: `${criteria.cuisine ?? ""} restaurants`.trim(),
      location: criteria.location.placeName ?? criteria.location.raw,
      categories: "restaurants",
      open_now: "true",
      limit: "8",
      sort_by: "best_match",
    });
    const response = await this.fetchImpl(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Yelp availability search failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      businesses?: Array<{
        name?: string;
        url?: string;
        price?: string;
        location?: { display_address?: string[] };
        transactions?: string[];
      }>;
    };

    return (body.businesses ?? [])
      .map((business) => ({
        source: "yelp" as const,
        name: business.name ?? "Unknown restaurant",
        url: business.url,
        address: business.location?.display_address?.join(", "),
        reason: [
          "Open now per Yelp.",
          business.transactions?.length ?
            `Yelp transaction hints: ${business.transactions.join(", ")}.`
          : undefined,
          "Browser Use must verify direct online ordering and cartability.",
        ]
          .filter(Boolean)
          .join(" "),
        dietaryFit: [],
        openNow: true,
      }))
      .filter((candidate) => candidate.name !== "Unknown restaurant");
  }
}

function dedupeCandidates(
  candidates: RestaurantAvailabilityCandidate[],
): RestaurantAvailabilityCandidate[] {
  const seen = new Set<string>();
  const unique: RestaurantAvailabilityCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.name.toLowerCase()}|${candidate.address?.toLowerCase() ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}
