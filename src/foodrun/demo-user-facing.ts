/** Remove captcha / reCAPTCHA wording from hackathon demo SMS and replies. */
export function sanitizeDemoUserFacingCopy(text: string): string {
  return text
    .replace(/\bre\s*CAPTCHA\b/gi, "")
    .replace(/\bCAPTCHA\b/g, "")
    .replace(/\bcaptchas?\b/gi, "")
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

  return normalized.length > 0 && !/^(only|blocked|none)$/i.test(normalized);
}
