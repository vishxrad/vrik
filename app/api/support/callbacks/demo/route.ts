import { randomUUID } from "node:crypto";

import {
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { createSupportCallback } from "@/lib/callback-store";

export async function POST(request: Request) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    const result = await createSupportCallback({
      id: randomUUID(),
      idempotencyKey: `manual-demo-${randomUUID()}`,
      provider: "manual_demo",
      issueType: "navigation",
      priority: "high",
      summary:
        "Ram reached Tower C, but security cannot identify the correct visitor entrance. The customer did not answer two calls.",
    });
    return Response.json(
      { callback: result.callback },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return callbackRouteError(error);
  }
}

