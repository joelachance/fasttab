import { describe, expect, test } from "bun:test";

import {
  buildSplitLineItems,
  parseSplitPrompt,
  splitEvenly,
} from "../src/modules/split-bill";

describe("split bill parsing", () => {
  test("splits a dollar total evenly across phones", () => {
    const parsed = parseSplitPrompt("Split $92.17 from Demo Thai between +15551234567 +15557654321");
    const splits = buildSplitLineItems(parsed);

    expect(parsed.totalCents).toBe(9217);
    expect(splits.map((split) => split.amount.cents)).toEqual([4609, 4608]);
  });

  test("parses per-person amounts", () => {
    const parsed = parseSplitPrompt("Joe +15551234567 45.00 Sam +15557654321 47.17");
    const splits = buildSplitLineItems(parsed);

    expect(splits.map((split) => split.amount.cents)).toEqual([4500, 4717]);
  });

  test("parses JSON with display names", () => {
    const parsed = parseSplitPrompt(
      JSON.stringify({
        restaurantName: "Demo Thai",
        participants: [
          { displayName: "Joe", phoneNumber: "+15551234567", amountCents: 4500 },
        ],
      }),
    );
    const splits = buildSplitLineItems(parsed);

    expect(splits[0]?.description).toContain("Joe");
  });

  test("splitEvenly distributes remainder to earlier participants", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  });
});
