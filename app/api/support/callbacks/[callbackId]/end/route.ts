import {
  callbackJsonError,
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { endSupportCallback } from "@/lib/callback-store";

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/callbacks/[callbackId]/end">,
) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      reason?: unknown;
    };
    const reason = body.reason;
    if (reason !== "completed" && reason !== "declined" && reason !== "cancelled") {
      return callbackJsonError(400, "INVALID_REQUEST", "Choose a valid call end reason.");
    }
    const { callbackId } = await context.params;
    const callback = await endSupportCallback(callbackId, reason);
    if (!callback) return callbackJsonError(404, "CALLBACK_NOT_FOUND", "Callback not found.");
    if (callback.status !== reason) {
      return callbackJsonError(409, "INVALID_CALL_STATE", "This callback has already ended.");
    }
    return Response.json({ callback }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return callbackRouteError(error);
  }
}

