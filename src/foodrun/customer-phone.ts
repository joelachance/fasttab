import type { Env } from "../env.js";
import type { FoodrunOrderSession, FoodrunParticipant } from "./order-state.js";

export function normalizePhone(phoneNumber?: string): string | undefined {
  const normalized = phoneNumber?.replace(/[^\d+]/g, "");

  return normalized || undefined;
}

function agentPhones(session: FoodrunOrderSession, env?: Env): Set<string> {
  const excluded = new Set<string>();
  const fromEnv = normalizePhone(env?.AGENTPHONE_PHONE_NUMBER ?? env?.AGENTPHONE_NUMBER);
  const fromSession = normalizePhone(session.agentPhoneNumber);

  if (fromEnv) {
    excluded.add(fromEnv);
  }
  if (fromSession) {
    excluded.add(fromSession);
  }

  return excluded;
}

function isCustomerPhone(phone: string | undefined, excluded: Set<string>): phone is string {
  const normalized = normalizePhone(phone);

  return Boolean(normalized && !excluded.has(normalized));
}

/** Customer E.164 for delivery/checkout — never AgentPhone's outbound number. */
export function resolveCustomerDeliveryPhone(
  session: FoodrunOrderSession,
  participants: FoodrunParticipant[],
  env?: Env,
): string | undefined {
  const excluded = agentPhones(session, env);
  const initiator = participants.find(
    (participant) => participant.role === "initiator" && isCustomerPhone(participant.phoneNumber, excluded),
  );

  if (initiator) {
    return initiator.phoneNumber;
  }

  if (isCustomerPhone(session.initiatorPhoneNumber, excluded)) {
    return session.initiatorPhoneNumber;
  }

  return participants.find((participant) => isCustomerPhone(participant.phoneNumber, excluded))
    ?.phoneNumber;
}
