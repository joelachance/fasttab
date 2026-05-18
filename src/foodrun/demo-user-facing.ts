/** Strip captcha wording and any leaked stub/demo phrasing from outbound SMS. */
export function sanitizeDemoUserFacingCopy(text: string): string {
  return text
    .replace(/\bre\s*CAPTCHA\b/gi, "")
    .replace(/\bCAPTCHA\b/g, "")
    .replace(/\bcaptchas?\b/gi, "")
    .replace(/\bFastTab demo\b/gi, "FastTab")
    .replace(/\s*\(not a real order\)\.?/gi, "")
    .replace(/\bnot a real order\.?/gi, "")
    .replace(/\bhackathon\b/gi, "")
    .replace(/\bdemo cart\b/gi, "cart")
    .replace(/\bdemo checkout\b/gi, "checkout")
    .replace(/\bFoodrun demo\b/gi, "FastTab")
    .replace(/\bStripe test card\b/gi, "card")
    .replace(/\bor\s+or\b/gi, "or")
    .replace(/Blocked by:\s*,/gi, "Blocked by:")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/^,\s*/, "")
    .trim();
}

export function demoBlockersForUserFacing(blockers: string[]): string[] {
  return blockers
    .map(sanitizeDemoUserFacingCopy)
    .filter((blocker) => isMeaningfulDemoBlocker(blocker));
}

function isMeaningfulDemoBlocker(blocker: string): boolean {
  const normalized = blocker.replace(/\s+/g, " ").trim().toLowerCase();

  return (
    normalized.length > 0 &&
    !/^(only|blocked|none)$/i.test(normalized) &&
    !normalized.includes("__fasttab_stub")
  );
}
