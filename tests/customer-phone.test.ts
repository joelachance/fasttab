import { describe, expect, test } from "bun:test";

import { resolveCustomerDeliveryPhone } from "../src/foodrun/customer-phone.js";
import type { FoodrunOrderSession, FoodrunParticipant } from "../src/foodrun/order-state.js";

const baseSession: FoodrunOrderSession = {
  roomId: "room_123",
  state: "building_cart",
  initiatorPhoneNumber: "+15551234567",
  agentPhoneNumber: "+15557654321",
  confirmedPreferences: {},
  supermemoryContext: [],
  stripePaymentLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const initiator: FoodrunParticipant = {
  participantId: "p_init",
  roomId: "room_123",
  phoneNumber: "+15551234567",
  role: "initiator",
  preferences: {},
  joinedAt: new Date(),
};

describe("resolveCustomerDeliveryPhone", () => {
  test("prefers initiator participant over agent env number", () => {
    expect(
      resolveCustomerDeliveryPhone(baseSession, [initiator], {
        AGENTPHONE_PHONE_NUMBER: "+15557654321",
      }),
    ).toBe("+15551234567");
  });

  test("falls back to session initiator when participant list is empty", () => {
    expect(resolveCustomerDeliveryPhone(baseSession, [])).toBe("+15551234567");
  });

  test("skips agent phone when it matches initiator slot", () => {
    const session = { ...baseSession, initiatorPhoneNumber: "+15557654321" };
    const guest: FoodrunParticipant = {
      ...initiator,
      participantId: "p_guest",
      phoneNumber: "+15559876543",
      role: "participant",
    };

    expect(resolveCustomerDeliveryPhone(session, [guest])).toBe("+15559876543");
  });

  test("returns undefined when only agent numbers are present", () => {
    const session = { ...baseSession, initiatorPhoneNumber: "+15557654321" };

    expect(
      resolveCustomerDeliveryPhone(session, [], { AGENTPHONE_PHONE_NUMBER: "+15557654321" }),
    ).toBeUndefined();
  });
});
