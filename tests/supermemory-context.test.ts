import { describe, expect, test } from "bun:test";

import {
  mergeSupermemoryIntoPreferences,
  normalizeSupermemorySearchResult,
  supermemoryHints,
  supermemoryQueryFromPreferences,
} from "../src/foodrun/supermemory-context";

describe("supermemory-context", () => {
  test("builds a search query from confirmed preferences", () => {
    expect(
      supermemoryQueryFromPreferences({
        cuisines: ["Thai"],
        dietary: ["vegetarian"],
        allergies: ["peanuts"],
        location: "Mission",
      }),
    ).toBe("Thai vegetarian no peanuts Mission");
  });

  test("normalizes search API payloads", () => {
    expect(normalizeSupermemorySearchResult({ memories: [{ content: "vegan" }] })).toEqual([
      { content: "vegan" },
    ]);
  });

  test("merges memory hints into preference notes", () => {
    expect(
      mergeSupermemoryIntoPreferences(
        { cuisines: ["Thai"] },
        [{ content: "usually orders mild" }],
      ).notes,
    ).toEqual(["Past preferences: usually orders mild"]);
  });

  test("extracts hint text from memory entries", () => {
    expect(supermemoryHints([{ content: "no dairy" }, "gluten free"])).toEqual([
      "no dairy",
      "gluten free",
    ]);
  });
});
