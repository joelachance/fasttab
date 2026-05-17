import { z } from "zod";

import type { SplitLineItem } from "../../types.js";

export type ParsedSplitPrompt = {
  roomId?: string;
  totalCents?: number;
  restaurantName?: string;
  participants: Array<{
    id: string;
    phoneNumber: string;
    displayName?: string;
    shareCents?: number;
  }>;
};

const PHONE_PATTERN = /\+[1-9]\d{9,14}(?!\d)/g;
const TOTAL_DOLLAR_PATTERN = /\$\s*(\d+\.\d{2}|\d+)(?!\d)/;
const TOTAL_LABEL_PATTERN = /(?:total|bill|order)\s*(?:is|:)?\s*\$?\s*(\d+\.\d{2}|\d+)(?!\d)/i;
const PERSON_AMOUNT_PATTERN =
  /(?<name>[A-Za-z][A-Za-z0-9_-]*)\s+(?<phone>\+[1-9]\d{9,14}(?!\d))\s*(?:[:=-]\s*)?\$?\s*(?<amount>\d+(?:\.\d{2})?)(?!\d)/g;

const jsonParticipantSchema = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    phoneNumber: z.string().regex(/^\+[1-9]\d{9,14}$/),
    shareCents: z.number().int().positive().optional(),
    amountCents: z.number().int().positive().optional(),
  })
  .transform((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
    phoneNumber: participant.phoneNumber,
    shareCents: participant.shareCents ?? participant.amountCents,
  }));

const jsonPromptSchema = z.object({
  participants: z.array(jsonParticipantSchema).min(1),
  roomId: z.string().optional(),
  totalCents: z.number().int().positive().optional(),
  restaurantName: z.string().optional(),
});

function dollarsToCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function slugParticipantId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniquePhones(prompt: string): string[] {
  return Array.from(new Set(prompt.match(PHONE_PATTERN) ?? []));
}

function restaurantNameFromPrompt(prompt: string): string | undefined {
  return prompt.match(/from\s+(.+?)\s+between\s+/i)?.[1]?.trim();
}

function parseTotalCents(prompt: string): number | undefined {
  const labeled = prompt.match(TOTAL_LABEL_PATTERN)?.[1];
  if (labeled) {
    return dollarsToCents(labeled);
  }

  const dollar = prompt.match(TOTAL_DOLLAR_PATTERN)?.[1];
  return dollar ? dollarsToCents(dollar) : undefined;
}

export function parseSplitPrompt(prompt: string): ParsedSplitPrompt {
  const trimmed = prompt.trim();

  if (!trimmed) {
    throw new Error("Split prompt is empty");
  }

  if (trimmed.startsWith("{")) {
    const parsed = jsonPromptSchema.parse(JSON.parse(trimmed));
    return {
      roomId: parsed.roomId,
      totalCents: parsed.totalCents,
      restaurantName: parsed.restaurantName,
      participants: parsed.participants.map((participant, index) => ({
        id: participant.id ?? `guest-${index + 1}`,
        displayName: participant.displayName,
        phoneNumber: participant.phoneNumber,
        shareCents: participant.shareCents,
      })),
    };
  }

  const phones = uniquePhones(trimmed);

  if (phones.length === 0) {
    throw new Error("No phone numbers found. Use E.164 format like +15551234567.");
  }

  const explicitParticipants: ParsedSplitPrompt["participants"] = [];
  for (const match of trimmed.matchAll(PERSON_AMOUNT_PATTERN)) {
    if (!match.groups) {
      continue;
    }

    explicitParticipants.push({
      id: slugParticipantId(match.groups.name) || `guest-${explicitParticipants.length + 1}`,
      displayName: match.groups.name,
      phoneNumber: match.groups.phone,
      shareCents: dollarsToCents(match.groups.amount),
    });
  }

  if (explicitParticipants.length > 0) {
    const seen = new Set<string>();
    const participants = explicitParticipants.filter((participant) => {
      if (seen.has(participant.phoneNumber)) {
        return false;
      }
      seen.add(participant.phoneNumber);
      return true;
    });

    return {
      totalCents: participants.reduce((sum, participant) => sum + (participant.shareCents ?? 0), 0),
      restaurantName: restaurantNameFromPrompt(trimmed),
      participants,
    };
  }

  return {
    totalCents: parseTotalCents(trimmed),
    restaurantName: restaurantNameFromPrompt(trimmed),
    participants: phones.map((phoneNumber, index) => ({
      id: `guest-${index + 1}`,
      phoneNumber,
    })),
  };
}

export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) {
    throw new Error("Split count must be positive");
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function buildSplitLineItems(
  parsed: ParsedSplitPrompt,
  options?: { roomId?: string; defaultDescription?: string },
): SplitLineItem[] {
  const allSharesExplicit = parsed.participants.every(
    (participant) => participant.shareCents !== undefined,
  );
  const shares =
    allSharesExplicit ?
      parsed.participants.map((participant) => participant.shareCents!)
    : parsed.totalCents !== undefined ?
      splitEvenly(parsed.totalCents, parsed.participants.length)
    : null;

  if (!shares) {
    throw new Error("Could not determine bill total. Include $92.17 or per-person amounts.");
  }

  const description =
    options?.defaultDescription ??
    (parsed.restaurantName ? `Foodrun split — ${parsed.restaurantName}` : "Foodrun split");

  return parsed.participants.map((participant, index) => ({
    participantId: participant.id,
    phoneNumber: participant.phoneNumber,
    amount: { currency: "usd", cents: shares[index] },
    description: participant.displayName ? `${description} (${participant.displayName})` : description,
  }));
}
