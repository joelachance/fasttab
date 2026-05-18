import { describe, expect, test } from "bun:test";

import { formatPaymentLinkSms } from "../src/foodrun/collect-splits";

describe("collect splits", () => {
  test("formatPaymentLinkSms includes amount, url, and restaurant", () => {
    const body = formatPaymentLinkSms(
      {
        participantId: "guest-1",
        phoneNumber: "+15551234567",
        amountCents: 4609,
        url: "https://buy.stripe.com/test_123",
      },
      "Nari Thai Kitchen",
    );

    expect(body).toContain("$46.09");
    expect(body).toContain("https://buy.stripe.com/test_123");
    expect(body).toContain("Nari Thai Kitchen");
    expect(body.toLowerCase()).not.toContain("demo");
    expect(body.toLowerCase()).not.toContain("test card");
  });
});
