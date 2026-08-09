export const DEMO_CALLBACK = {
  rider: {
    id: "R-108",
    name: "Ram Kumar",
    initials: "RK",
    phoneDisplay: "+91 98••• ••210",
    language: "Hindi",
    languageCode: "hi-IN",
  },
  support: {
    name: "Zomato Support",
    language: "English",
    languageCode: "en-IN",
  },
  order: {
    id: "4821",
    restaurant: "Empire Restaurant",
    customer: "Ananya",
    destination: "Tower C, Indiranagar",
  },
  issue: {
    type: "Can’t find customer entrance",
    priority: "High",
    summary:
      "Ram reached Tower C, but security cannot identify the correct visitor entrance. The customer did not answer two calls.",
  },
} as const;

export type CallbackDemoEvent =
  | { type: "ring"; at: number; callbackId?: string }
  | { type: "accept"; at: number; callbackId?: string }
  | { type: "decline"; at: number; callbackId?: string }
  | { type: "end"; at: number; callbackId?: string };

export const CALLBACK_DEMO_CHANNEL = "vrik-callback-demo-v1";

export type CallbackApiRecord = {
  id: string;
  orderId: string;
  issueType: string;
  priority: string;
  status: "requested" | "ringing" | "connected" | "completed" | "declined" | "cancelled";
  summary?: string;
  riderLanguage?: "hi-IN";
  supportLanguage?: "en-IN";
};
