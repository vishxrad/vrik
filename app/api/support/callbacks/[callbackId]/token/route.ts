import { AccessToken } from "livekit-server-sdk";

import {
  callbackJsonError,
  callbackRouteError,
  guardSameOriginCallbackRequest,
} from "@/lib/callback-http";
import { getSupportCallback } from "@/lib/callback-store";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/callbacks/[callbackId]/token">,
) {
  const blocked = guardSameOriginCallbackRequest(request);
  if (blocked) return blocked;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !serverUrl) {
    return callbackJsonError(
      503,
      "LIVEKIT_NOT_CONFIGURED",
      "Translated VoIP is not configured yet.",
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { role?: unknown };
    if (body.role !== "rider" && body.role !== "support") {
      return callbackJsonError(400, "INVALID_REQUEST", "Choose a valid call role.");
    }

    const { callbackId } = await context.params;
    const callback = await getSupportCallback(callbackId);
    if (!callback) return callbackJsonError(404, "CALLBACK_NOT_FOUND", "Callback not found.");
    if (callback.status !== "ringing" && callback.status !== "connected") {
      return callbackJsonError(409, "INVALID_CALL_STATE", "This callback is not active.");
    }

    const roomName = `callback-${callback.id}`;
    const identity = body.role === "rider" ? "rider-R-108" : "support-demo";
    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: body.role === "rider" ? "Ram Kumar" : "Zomato Support",
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    return Response.json(
      {
        serverUrl,
        participantToken: await token.toJwt(),
        roomName,
        identity,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return callbackRouteError(error);
  }
}
