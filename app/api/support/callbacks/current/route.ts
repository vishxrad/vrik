import {
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { getRiderVisibleCallback } from "@/lib/callback-store";

export async function GET(request: Request) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    const callback = await getRiderVisibleCallback();
    return Response.json(
      {
        callback: callback
          ? {
              id: callback.id,
              orderId: callback.orderId,
              issueType: callback.issueType,
              priority: callback.priority,
              riderLanguage: callback.riderLanguage,
              supportLanguage: callback.supportLanguage,
              status: callback.status,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return callbackRouteError(error);
  }
}

