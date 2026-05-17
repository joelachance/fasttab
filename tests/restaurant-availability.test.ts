import { describe, expect, test } from "bun:test";

import { RestaurantAvailabilityModule } from "../src/modules/restaurant-availability";
import type { OrderCriteria } from "../src/types";

const criteria: OrderCriteria = {
  roomId: "room_123",
  location: { raw: "Dogpatch, San Francisco", placeName: "Dogpatch, San Francisco" },
  cuisine: "Thai",
  pickupOrDelivery: "pickup",
  participantCount: 2,
  preferences: ["vegetarian"],
  allergies: ["peanuts"],
};

describe("RestaurantAvailabilityModule", () => {
  test("returns no candidates when provider keys are absent", async () => {
    const module = new RestaurantAvailabilityModule({}, async () => {
      throw new Error("fetch should not run without provider keys");
    });

    await expect(module.findCandidates(criteria)).resolves.toEqual([]);
  });

  test("combines open Google Places and Yelp candidates", async () => {
    const requests: string[] = [];
    const module = new RestaurantAvailabilityModule(
      { GOOGLE_PLACES_API_KEY: "google_key", YELP_API_KEY: "yelp_key" },
      async (input) => {
        const url = String(input);
        requests.push(url);

        if (url.includes("places.googleapis.com")) {
          return jsonResponse({
            places: [
              {
                displayName: { text: "Open Thai" },
                formattedAddress: "123 Mission St, San Francisco, CA",
                websiteUri: "https://openthai.example.com",
                currentOpeningHours: { openNow: true },
              },
              {
                displayName: { text: "Closed Thai" },
                formattedAddress: "456 Mission St, San Francisco, CA",
                websiteUri: "https://closedthai.example.com",
                currentOpeningHours: { openNow: false },
              },
            ],
          });
        }

        return jsonResponse({
          businesses: [
            {
              name: "Yelp Thai",
              url: "https://yelp.example.com/yelp-thai",
              location: { display_address: ["789 Mission St", "San Francisco, CA"] },
              transactions: ["pickup"],
            },
          ],
        });
      },
    );

    const candidates = await module.findCandidates(criteria);

    expect(requests.some((url) => url.includes("places.googleapis.com"))).toBe(true);
    expect(requests.some((url) => url.includes("api.yelp.com"))).toBe(true);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["Open Thai", "Yelp Thai"]);
    expect(candidates[0]).toMatchObject({
      source: "google_places",
      orderingUrl: "https://openthai.example.com",
      openNow: true,
    });
    expect(candidates[1]).toMatchObject({
      source: "yelp",
      url: "https://yelp.example.com/yelp-thai",
      openNow: true,
    });
  });

  test("dedupes candidates by name and address", async () => {
    const module = new RestaurantAvailabilityModule(
      { GOOGLE_PLACES_API_KEY: "google_key", YELP_API_KEY: "yelp_key" },
      async (input) => {
        const url = String(input);

        if (url.includes("places.googleapis.com")) {
          return jsonResponse({
            places: [
              {
                displayName: { text: "Open Thai" },
                formattedAddress: "123 Mission St",
                websiteUri: "https://google.example.com/open-thai",
                currentOpeningHours: { openNow: true },
              },
            ],
          });
        }

        return jsonResponse({
          businesses: [
            {
              name: "Open Thai",
              url: "https://yelp.example.com/open-thai",
              location: { display_address: ["123 Mission St"] },
            },
          ],
        });
      },
    );

    const candidates = await module.findCandidates(criteria);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.source).toBe("google_places");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
