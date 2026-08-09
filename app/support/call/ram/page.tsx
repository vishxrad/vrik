import type { Metadata } from "next";

import { SupportCallbackConsole } from "@/components/callback/support-callback-console";

export const metadata: Metadata = {
  title: "Ram callback · Zomato Partner Support",
  description: "Translated support callback console for the Vrik delivery demo.",
};

export default function RamSupportCallbackPage() {
  return <SupportCallbackConsole />;
}

