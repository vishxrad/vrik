import {
  guardLocalTranslationRequest,
  invalidSarvamResponse,
  isLocalLanguageCode,
  jsonError,
  parseSarvamJson,
  sarvamErrorResponse,
  sarvamFetch,
} from "@/lib/local-translation";

export const maxDuration = 60;

export async function POST(request: Request) {
  const blocked = guardLocalTranslationRequest(request, "synthesize");
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      text?: unknown;
      language?: unknown;
    };
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Enter some text to speak.",
        false,
      );
    }

    if (text.length > 2_500) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Keep spoken messages under 2,500 characters.",
        false,
      );
    }

    if (!isLocalLanguageCode(body.language)) {
      return jsonError(
        400,
        "UNSUPPORTED_LANGUAGE",
        "Choose Tamil, Kannada, Hindi, or English.",
        false,
      );
    }

    const upstream = await sarvamFetch("text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        target_language_code: body.language,
        model: "bulbul:v3",
        speaker: "shubh",
        output_audio_codec: "wav",
        speech_sample_rate: 24_000,
        pace: 1,
        temperature: 0.6,
      }),
    });
    if (upstream instanceof Response && upstream.status === 503) return upstream;

    const upstreamBody = await parseSarvamJson(upstream);
    const audio =
      Array.isArray(upstreamBody.audios) &&
      typeof upstreamBody.audios[0] === "string"
        ? upstreamBody.audios[0]
        : "";

    if (!audio) return invalidSarvamResponse();

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(audio, "base64"));
    } catch {
      return invalidSarvamResponse();
    }

    if (bytes.length === 0) return invalidSarvamResponse();

    const requestId =
      typeof upstreamBody.request_id === "string" ? upstreamBody.request_id : "";

    const audioBody = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    return new Response(audioBody, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/wav",
        "Content-Length": String(bytes.length),
        ...(requestId ? { "X-Sarvam-Request-Id": requestId } : {}),
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(400, "INVALID_REQUEST", "Send a valid JSON request.", false);
    }
    if (error instanceof TypeError && error.message === "Invalid Sarvam response") {
      return invalidSarvamResponse();
    }
    return sarvamErrorResponse(error);
  }
}
