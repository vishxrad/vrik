import {
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { getLatestSupportCallback } from "@/lib/callback-store";

export async function GET(request: Request) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;
  try {
    return Response.json(
      { callback: await getLatestSupportCallback() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return callbackRouteError(error);
  }
}

