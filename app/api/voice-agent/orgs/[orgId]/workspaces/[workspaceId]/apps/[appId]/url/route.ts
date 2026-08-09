import { VOICE_AGENT_CONFIG } from "@/lib/voice-agent-config";

export const maxDuration = 15;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_BASE_URL = "https://apps.sarvam.ai/api/app-runtime";
const DEFAULT_TIMEOUT_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 8;
const rateLimitBuckets = new Map<string, RateLimitBucket>();

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  headers?: HeadersInit,
) {
  return Response.json(
    { error: { code, message, retryable } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

function isCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

function rateLimitResponse(request: Request) {
  const now = Date.now();
  const address = clientAddress(request);
  const bucket = rateLimitBuckets.get(address);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(address, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }

  if (bucket.count >= RATE_LIMIT_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many support calls were started. Wait a moment and try again.",
      true,
      { "Retry-After": String(retryAfter) },
    );
  }

  bucket.count += 1;

  if (rateLimitBuckets.size > 1_000) {
    for (const [key, value] of rateLimitBuckets) {
      if (value.resetAt <= now) rateLimitBuckets.delete(key);
    }
  }

  return null;
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/voice-agent/orgs/[orgId]/workspaces/[workspaceId]/apps/[appId]/url">,
) {
  if (isCrossOrigin(request)) {
    return errorResponse(
      403,
      "CROSS_ORIGIN_REQUEST",
      "Support calls can only be started from the delivery app.",
      false,
    );
  }

  const { orgId, workspaceId, appId } = await context.params;
  if (
    orgId !== VOICE_AGENT_CONFIG.orgId ||
    workspaceId !== VOICE_AGENT_CONFIG.workspaceId ||
    appId !== VOICE_AGENT_CONFIG.appId
  ) {
    return errorResponse(404, "AGENT_NOT_FOUND", "Support agent not found.", false);
  }

  const requestUrl = new URL(request.url);
  if (
    requestUrl.searchParams.get("interaction_type") !== "call" ||
    requestUrl.searchParams.get("version") !== String(VOICE_AGENT_CONFIG.version)
  ) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "This endpoint only starts the configured voice support call.",
      false,
    );
  }

  const limited = rateLimitResponse(request);
  if (limited) return limited;

  const apiKey = process.env.SARVAM_VOICE_AGENT_API_KEY;
  if (!apiKey) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Voice support is not configured yet.",
      false,
    );
  }

  const timeoutSetting = Number(process.env.SARVAM_VOICE_AGENT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutSetting) && timeoutSetting > 0
      ? timeoutSetting
      : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = (
    process.env.SARVAM_VOICE_AGENT_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const upstreamUrl = new URL(
    `${baseUrl}/orgs/${VOICE_AGENT_CONFIG.orgId}/workspaces/${VOICE_AGENT_CONFIG.workspaceId}/apps/${VOICE_AGENT_CONFIG.appId}/url`,
  );
  upstreamUrl.searchParams.set("interaction_type", "call");
  upstreamUrl.searchParams.set("version", String(VOICE_AGENT_CONFIG.version));
  upstreamUrl.searchParams.set(
    "user_identifier",
    `rider-${VOICE_AGENT_CONFIG.rider.id}`,
  );
  upstreamUrl.searchParams.set("user_identifier_type", "custom");

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
      headers: { "X-API-Key": apiKey },
      signal: controller.signal,
    });
    const body = await upstream.text();
    const retryAfter = upstream.headers.get("retry-after");

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return errorResponse(
          429,
          "RATE_LIMITED",
          "Voice support is busy. Wait a moment and try again.",
          true,
          retryAfter ? { "Retry-After": retryAfter } : undefined,
        );
      }

      if (upstream.status >= 500) {
        return errorResponse(
          503,
          "SARVAM_UNAVAILABLE",
          "Voice support is temporarily unavailable. Try again.",
          true,
        );
      }

      return errorResponse(
        502,
        "SARVAM_REJECTED_REQUEST",
        "Sarvam could not start the support call.",
        false,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return errorResponse(
        502,
        "INVALID_SARVAM_RESPONSE",
        "Voice support returned an invalid response. Try again.",
        true,
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { url?: unknown }).url !== "string" ||
      typeof (parsed as { reference_id?: unknown }).reference_id !== "string"
    ) {
      return errorResponse(
        502,
        "INVALID_SARVAM_RESPONSE",
        "Voice support returned an invalid response. Try again.",
        true,
      );
    }

    return Response.json(parsed, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return errorResponse(
        504,
        "SARVAM_TIMEOUT",
        "Voice support took too long to connect. Try again.",
        true,
      );
    }

    return errorResponse(
      502,
      "SARVAM_UNAVAILABLE",
      "Voice support is temporarily unavailable. Try again.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
