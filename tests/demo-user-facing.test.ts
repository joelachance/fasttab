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
  });
});
