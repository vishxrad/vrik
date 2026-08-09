import "server-only";

import { timingSafeEqual } from "node:crypto";

import { CallbackDatabaseNotConfiguredError } from "@/lib/callback-store";

export function callbackJsonError(
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return Response.json(
    { error: { code, message, retryable } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function isCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

export function guardSameOriginCallbackRequest(request: Request) {
  return isCrossOrigin(request)
    ? callbackJsonError(
        403,
        "CROSS_ORIGIN_REQUEST",
        "Callbacks can only be controlled from the demo app.",
      )
    : null;
}

export function hasValidWebhookSecret(request: Request) {
  const expected = process.env.CALLBACK_WEBHOOK_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export function callbackRouteError(error: unknown) {
  if (error instanceof CallbackDatabaseNotConfiguredError) {
    return callbackJsonError(
      503,
      "DATABASE_NOT_CONFIGURED",
      "The callback database is not configured yet.",
      false,
    );
  }
  return callbackJsonError(
    500,
    "CALLBACK_SERVICE_ERROR",
    "The callback service could not complete this request.",
    true,
  );
}

