import {
  callbackJsonError,
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { ringSupportCallback } from "@/lib/callback-store";

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/callbacks/[callbackId]/ring">,
) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    const { callbackId } = await context.params;
    const callback = await ringSupportCallback(callbackId);
    if (!callback) return callbackJsonError(404, "CALLBACK_NOT_FOUND", "Callback not found.");
    if (callback.status !== "ringing") {
      return callbackJsonError(409, "INVALID_CALL_STATE", "This callback can no longer ring.");
    }
    return Response.json({ callback }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return callbackRouteError(error);
  }
}

