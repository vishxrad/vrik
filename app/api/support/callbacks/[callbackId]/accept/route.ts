import {
  callbackJsonError,
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { acceptSupportCallback } from "@/lib/callback-store";

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/callbacks/[callbackId]/accept">,
) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    const { callbackId } = await context.params;
    const callback = await acceptSupportCallback(callbackId);
    if (!callback) return callbackJsonError(404, "CALLBACK_NOT_FOUND", "Callback not found.");
    if (callback.status !== "connected") {
      return callbackJsonError(409, "INVALID_CALL_STATE", "This callback cannot be answered now.");
    }
    return Response.json({ callback }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return callbackRouteError(error);
  }
}

