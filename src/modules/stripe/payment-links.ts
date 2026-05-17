import type { SplitLineItem } from "../../types.js";
import type { StripeClientLike } from "./client.js";
import type { StripePaymentLink } from "./types.js";

function sanitizeIdempotencyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 255);
}

export function paymentLinkIdempotencyKey(roomId: string, split: SplitLineItem): string {
  return sanitizeIdempotencyKey(
    ["foodrun", roomId, split.participantId, split.amount.currency, split.amount.cents, split.description].join(
      ":",
    ),
  );
}

/** One Stripe Payment Link per participant so each person can pay their share. */
export async function createSplitPaymentLinks(
  client: StripeClientLike,
  splits: SplitLineItem[],
  roomId = "demo",
): Promise<StripePaymentLink[]> {
  const links: StripePaymentLink[] = [];

  for (const split of splits) {
    const keyBase = paymentLinkIdempotencyKey(roomId, split);
    const metadata = {
      participantId: split.participantId,
      phoneNumber: split.phoneNumber,
    };
    const price = await client.prices.create(
      {
        currency: split.amount.currency,
        unit_amount: split.amount.cents,
        product_data: { name: split.description },
        metadata,
      },
      { idempotencyKey: `${keyBase}:price` },
    );
    const link = await client.paymentLinks.create(
      {
        line_items: [{ price: price.id, quantity: 1 }],
        metadata,
      },
      { idempotencyKey: `${keyBase}:payment-link` },
    );

    links.push({
      participantId: split.participantId,
      phoneNumber: split.phoneNumber,
      amountCents: split.amount.cents,
      url: link.url,
    });
  }

  return links;
}
