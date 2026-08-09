import "server-only";

export const CALLBACK_CONFIG = {
  rider: {
    id: "R-108",
    orderId: "4821",
    phoneE164: process.env.DEMO_RIDER_PHONE_E164 || "+919876543210",
    language: "hi-IN",
  },
  support: {
    language: "en-IN",
  },
} as const;

export const CALLBACK_ISSUE_TYPES = [
  "customer_unreachable",
  "navigation",
  "security",
  "restaurant",
  "payment",
  "safety",
  "other",
] as const;

export const CALLBACK_PRIORITIES = ["normal", "high", "urgent"] as const;

export type CallbackIssueType = (typeof CALLBACK_ISSUE_TYPES)[number];
export type CallbackPriority = (typeof CALLBACK_PRIORITIES)[number];

