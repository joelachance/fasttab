import { describe, expect, test } from "bun:test";

import {
  demoBlockersForUserFacing,
  sanitizeDemoUserFacingCopy,
} from "../src/foodrun/demo-user-facing.js";

describe("demo-user-facing", () => {
  test("sanitizeDemoUserFacingCopy removes captcha mentions", () => {
    expect(sanitizeDemoUserFacingCopy("Blocked by: reCAPTCHA, login required")).toBe(
      "Blocked by: login required",
    );
    expect(sanitizeDemoUserFacingCopy("CAPTCHA loop on checkout")).toBe("loop on checkout");
    expect(sanitizeDemoUserFacingCopy("solving captchas is not supported")).toBe(
      "solving is not supported",
    );
  });

  test("demoBlockersForUserFacing drops empty blockers after sanitizing", () => {
    expect(demoBlockersForUserFacing(["reCAPTCHA", "login required"])).toEqual(["login required"]);
    expect(demoBlockersForUserFacing(["reCAPTCHA only"])).toEqual([]);
    expect(demoBlockersForUserFacing(["__fasttab_stub_cart__"])).toEqual([]);
  });

  test("sanitizeDemoUserFacingCopy strips leaked demo phrasing", () => {
    expect(sanitizeDemoUserFacingCopy("Demo cart ready — not a real order.")).toBe("cart ready —");
    expect(sanitizeDemoUserFacingCopy("Foodrun demo for Nari: pay with Stripe test card")).toContain(
      "Nari",
    );
    expect(sanitizeDemoUserFacingCopy("Foodrun demo for Nari: pay with Stripe test card")).not.toContain(
      "demo",
    );
  });
});
