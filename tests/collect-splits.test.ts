import { describe, expect, test } from "bun:test";

import { formatPaymentLinkSms } from "../src/foodrun/collect-splits";

describe("collect splits", () => {
  test("formatPaymentLinkSms includes amount, url, restaurant, and test card hint", () => {
    const body = formatPaymentLinkSms(
      {
        participantId: "guest-1",
        phoneNumber: "+15551234567",
        amountCents: 4609,
        url: "https://buy.stripe.com/test_123",
      },
      "Demo Thai",
    );

    expect(body).toContain("$46.09");
    expect(body).toContain("https://buy.stripe.com/test_123");
    expect(body).toContain("Demo Thai");
    expect(body).toContain("test card");
  });
});
