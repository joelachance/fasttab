import type { CartSummary, RestaurantOption, SplitLineItem } from "../types.js";
import type { FoodOrderCard } from "../modules/sponge/index.js";
import type { StripePaymentLink } from "../modules/stripe/index.js";

export type FoodrunOrderState =
  | "collecting_preferences"
  | "confirming_preferences"
  | "searching_restaurants"
  | "selecting_restaurant"
  | "building_cart"
  | "editing_cart"
  | "confirming_cart"
  | "issuing_card"
  | "checking_out"
  | "order_confirmed"
  | "splitting_bill"
  | "complete"
  | "failed";

export type FoodrunJobKind =
  | "restaurant_search"
  | "cart_build"
  | "cart_edit"
  | "checkout_payment"
  | "post_order_split";

export type FoodrunJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ParticipantPaymentStatus = "pending" | "sent" | "paid" | "expired" | "failed";

export type ConfirmedPreferences = {
  dietary?: string[];
  allergies?: string[];
  cuisines?: string[];
  address?: string;
  location?: string;
  budgetPerPersonCents?: number;
  pickupOrDelivery?: "pickup" | "delivery" | "either";
  notes?: string[];
};

export type OrderConfirmation = {
  restaurantName: string;
  confirmationNumber?: string;
  receiptUrl?: string;
  finalTotalCents?: number;
  eta?: string;
  raw?: unknown;
};

export type FoodrunOrderSession = {
  roomId: string;
  state: FoodrunOrderState;
  initiatorPhoneNumber: string;
  agentPhoneNumber?: string;
  originalPrompt?: string;
  confirmedPreferences: ConfirmedPreferences;
  supermemoryContext: unknown[];
  selectedRestaurant?: RestaurantOption;
  cart?: CartSummary;
  spongeCard?: FoodOrderCard;
  orderConfirmation?: OrderConfirmation;
  stripePaymentLinks: StripePaymentLink[];
  browserUseSessionId?: string;
  browserUseLiveUrl?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FoodrunParticipant = {
  participantId: string;
  roomId: string;
  phoneNumber: string;
  displayName?: string;
  role: "initiator" | "participant";
  preferences: ConfirmedPreferences;
  joinedAt: Date;
};

export type FoodrunCartItem = {
  cartItemId: string;
  roomId: string;
  name: string;
  quantity: number;
  priceCents?: number;
  notes?: string;
  raw: unknown;
  assignedParticipantIds: string[];
};

export type FoodrunParticipantPayment = {
  paymentId: string;
  roomId: string;
  participantId: string;
  phoneNumber: string;
  amountCents: number;
  currency: "usd";
  stripePaymentLinkUrl?: string;
  stripePaymentLinkId?: string;
  status: ParticipantPaymentStatus;
  metadata: Record<string, unknown>;
};

export type FoodrunJob = {
  jobId: string;
  roomId: string;
  kind: FoodrunJobKind;
  status: FoodrunJobStatus;
  attempts: number;
  runAfter: Date;
  lockedAt?: Date;
  lastError?: string;
  payload: Record<string, unknown>;
};

export type FinalSplit = SplitLineItem;
