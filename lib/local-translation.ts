import "server-only";

export const LOCAL_LANGUAGE_CODES = ["ta-IN", "kn-IN", "hi-IN", "en-IN"] as const;

export type LocalLanguageCode = (typeof LOCAL_LANGUAGE_CODES)[number];

type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_AUDIO"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_LANGUAGE"
  | "SAME_LANGUAGE"
  | "NO_SPEECH_DETECTED"
  | "RATE_LIMITED"
  | "CROSS_ORIGIN_REQUEST"
  | "SERVICE_NOT_CONFIGURED"
  | "SARVAM_REJECTED_REQUEST"
  | "SARVAM_UNAVAILABLE"
  | "SARVAM_TIMEOUT"
  | "INVALID_SARVAM_RESPONSE";

type JsonErrorOptions = {
  headers?: HeadersInit;
  requestId?: string | null;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const DEFAULT_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 20;
const rateLimitBuckets = new Map<string, RateLimitBucket>();

export function isLocalLanguageCode(value: unknown): value is LocalLanguageCode {
  return LOCAL_LANGUAGE_CODES.includes(value as LocalLanguageCode);
}

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  retryable: boolean,
  options: JsonErrorOptions = {},
) {
  return Response.json(
    {
      error: {
        code,
        message,
        retryable,
        ...(options.requestId ? { requestId: options.requestId } : {}),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...options.headers,
      },
    },
  );
}

function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
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

export function guardLocalTranslationRequest(request: Request, scope: string) {
  if (isCrossOrigin(request)) {
    return jsonError(
      403,
      "CROSS_ORIGIN_REQUEST",
      "This translation API only accepts requests from the delivery app.",
      false,
    );
  }

  const now = Date.now();
  const key = `${scope}:${clientAddress(request)}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  } else if (bucket.count >= RATE_LIMIT_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    return jsonError(
      429,
      "RATE_LIMITED",
      "Too many translation requests. Wait a moment and try again.",
      true,
      { headers: { "Retry-After": String(retryAfter) } },
    );
  } else {
    bucket.count += 1;
  }

  if (rateLimitBuckets.size > 1_000) {
    for (const [bucketKey, current] of rateLimitBuckets) {
      if (current.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  return null;
}

function messageFromUnknownBody(body: unknown) {
  if (!body || typeof body !== "object") return undefined;

  const candidate = body as {
    error?: { message?: unknown } | string;
    message?: unknown;
  };

  if (typeof candidate.error === "string") return candidate.error;
  if (typeof candidate.error?.message === "string") return candidate.error.message;
  return typeof candidate.message === "string" ? candidate.message : undefined;
}

async function readJsonSafely(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export class SarvamUpstreamError extends Error {
  constructor(public readonly response: Response) {
    super("Sarvam request failed");
  }
}

export class SarvamTimeoutError extends Error {}

export class SarvamNetworkError extends Error {}

export async function sarvamFetch(path: string, init: RequestInit) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return jsonError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Translation is not configured yet.",
      false,
    );
  }

  const configuredTimeout = Number(process.env.SARVAM_API_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
  const baseUrl = (process.env.SARVAM_API_BASE_URL || SARVAM_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/${path.replace(/^\//, "")}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...init.headers,
        "api-subscription-key": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new SarvamUpstreamError(response);
    return response;
  } catch (error) {
    if (error instanceof SarvamUpstreamError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SarvamTimeoutError();
    }
    throw new SarvamNetworkError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function sarvamErrorResponse(error: unknown) {
  if (error instanceof SarvamTimeoutError) {
    return jsonError(
      504,
      "SARVAM_TIMEOUT",
      "Translation took too long. Please try again.",
      true,
    );
  }

  if (error instanceof SarvamNetworkError) {
    return jsonError(
      502,
      "SARVAM_UNAVAILABLE",
      "Translation is temporarily unavailable. Please try again.",
      true,
    );
  }

  if (error instanceof SarvamUpstreamError) {
    const body = await readJsonSafely(error.response);
    const requestId =
      body && typeof body === "object" && "request_id" in body
        ? String((body as { request_id?: unknown }).request_id || "")
        : null;
    const retryAfter = error.response.headers.get("retry-after");

    if (error.response.status === 429) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "Translation is busy. Wait a moment and try again.",
        true,
        {
          headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
          requestId,
        },
      );
    }

    if (error.response.status >= 500) {
      return jsonError(
        503,
        "SARVAM_UNAVAILABLE",
        "Translation is temporarily unavailable. Please try again.",
        true,
        { requestId },
      );
    }

    return jsonError(
      502,
      "SARVAM_REJECTED_REQUEST",
      messageFromUnknownBody(body) || "Sarvam could not process this request.",
      false,
      { requestId },
    );
  }

  return jsonError(
    500,
    "SARVAM_UNAVAILABLE",
    "Something unexpected happened. Please try again.",
    true,
  );
}

export async function parseSarvamJson(response: Response) {
  const body = await readJsonSafely(response);
  if (!body || typeof body !== "object") {
    throw new TypeError("Invalid Sarvam response");
  }
  return body as Record<string, unknown>;
}

export function invalidSarvamResponse() {
  return jsonError(
    502,
    "INVALID_SARVAM_RESPONSE",
    "Translation returned an invalid response. Please try again.",
    true,
  );
}
