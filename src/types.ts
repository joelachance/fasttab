export type Money = { currency: "usd"; cents: number };

export type SplitLineItem = {
  participantId: string;
  phoneNumber: string;
  amount: Money;
  description: string;
};

export type LocationHint = {
  raw: string;
  latitude?: number;
  longitude?: number;
  placeName?: string;
};

export type OrderCriteria = {
  roomId: string;
  location: LocationHint;
  cuisine?: string;
  budgetPerPerson?: Money;
  pickupOrDelivery: "pickup" | "delivery" | "either";
  deadline?: string;
  participantCount: number;
  preferences: string[];
  allergies: string[];
  /** Customer phone for delivery/checkout (E.164), not AgentPhone's number. */
  deliveryPhone?: string;
  surpriseUs?: boolean;
};

export type RestaurantOption = {
  name: string;
  url?: string;
  orderingUrl?: string;
  address?: string;
  reason: string;
  estimatedPickupTime?: string;
  estimatedTotal?: Money;
  dietaryFit: string[];
};

export type CartItem = {
  name: string;
  quantity: number;
  assignedTo?: string[];
  notes?: string;
  price?: Money;
};

export type CartSummary = {
  restaurantName: string;
  checkoutUrl?: string;
  items: CartItem[];
  subtotal?: Money;
  taxesAndFees?: Money;
  estimatedTotal?: Money;
  screenshots: string[];
  status: "draft" | "checkout_ready" | "blocked";
  blockers: string[];
};
