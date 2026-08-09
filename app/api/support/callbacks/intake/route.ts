import { randomUUID } from "node:crypto";

import {
  CALLBACK_CONFIG,
  CALLBACK_ISSUE_TYPES,
  CALLBACK_PRIORITIES,
  type CallbackIssueType,
  type CallbackPriority,
} from "@/lib/callback-config";
import {
  callbackJsonError,
  callbackRouteError,
  hasValidWebhookSecret,
} from "@/lib/callback-http";
import { createSupportCallback } from "@/lib/callback-store";

export const maxDuration = 15;

const MAX_BODY_BYTES = 16 * 1024;

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  if (!process.env.CALLBACK_WEBHOOK_SECRET) {
    return callbackJsonError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "The callback webhook is not configured yet.",
    );
  }
  if (!hasValidWebhookSecret(request)) {
    return callbackJsonError(401, "UNAUTHORIZED", "Invalid callback webhook secret.");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return callbackJsonError(413, "PAYLOAD_TOO_LARGE", "Callback payload is too large.");
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      return callbackJsonError(413, "PAYLOAD_TOO_LARGE", "Callback payload is too large.");
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return callbackJsonError(400, "INVALID_REQUEST", "Send a valid JSON payload.");
    }

    const needsHuman = body.needsHuman === true || body.needsHuman === "yes";
    if (!needsHuman) {
      return Response.json(
        { accepted: false, reason: "human_callback_not_requested" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const callbackRequestId = stringValue(body.callbackRequestId, 128);
    const riderId = stringValue(body.riderId, 64);
    const orderId = stringValue(body.orderId, 64);
    const issueType = stringValue(body.issueType, 64) as CallbackIssueType;
    const priority = stringValue(body.priority, 16) as CallbackPriority;

    if (!isUuid(callbackRequestId)) {
      return callbackJsonError(400, "INVALID_REQUEST", "callbackRequestId must be a UUID.");
    }
    if (riderId !== CALLBACK_CONFIG.rider.id || orderId !== CALLBACK_CONFIG.rider.orderId) {
      return callbackJsonError(403, "RIDER_NOT_ALLOWED", "This demo only accepts Ram’s active order.");
    }
    if (!CALLBACK_ISSUE_TYPES.includes(issueType)) {
      return callbackJsonError(400, "INVALID_REQUEST", "Choose a supported callback issue type.");
    }
    if (!CALLBACK_PRIORITIES.includes(priority)) {
      return callbackJsonError(400, "INVALID_REQUEST", "Choose a supported callback priority.");
    }

    const result = await createSupportCallback({
      id: randomUUID(),
      idempotencyKey: callbackRequestId,
      provider: "sarvam_on_end",
      providerInteractionId: stringValue(body.interactionId, 160) || null,
      issueType,
      priority,
      summary: stringValue(body.summary, 1_000),
    });

    return Response.json(
      {
        accepted: true,
        created: result.created,
        callback: {
          id: result.callback.id,
          riderId: result.callback.riderId,
          orderId: result.callback.orderId,
          status: result.callback.status,
        },
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return callbackRouteError(error);
  }
}

