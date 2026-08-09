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
  const blocked = guardLocalTranslationRequest(request, "translate");
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      text?: unknown;
      sourceLanguage?: unknown;
      targetLanguage?: unknown;
    };
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Enter some text to translate.",
        false,
      );
    }

    if (text.length > 1_000) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Keep translated messages under 1,000 characters.",
        false,
      );
    }

    if (
      !isLocalLanguageCode(body.sourceLanguage) ||
      !isLocalLanguageCode(body.targetLanguage)
    ) {
      return jsonError(
        400,
        "UNSUPPORTED_LANGUAGE",
        "Choose Tamil, Kannada, Hindi, or English.",
        false,
      );
    }

    if (body.sourceLanguage === body.targetLanguage) {
      return jsonError(
        400,
        "SAME_LANGUAGE",
        "Source and target languages must be different.",
        false,
      );
    }

    const upstream = await sarvamFetch("translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        source_language_code: body.sourceLanguage,
        target_language_code: body.targetLanguage,
        model: "mayura:v1",
        mode: "modern-colloquial",
        output_script: "spoken-form-in-native",
        numerals_format: "international",
      }),
    });
    if (upstream instanceof Response && upstream.status === 503) return upstream;

    const upstreamBody = await parseSarvamJson(upstream);
    const translatedText =
      typeof upstreamBody.translated_text === "string"
        ? upstreamBody.translated_text.trim()
        : "";

    if (!translatedText) return invalidSarvamResponse();

    return Response.json(
      {
        requestId:
          typeof upstreamBody.request_id === "string" ? upstreamBody.request_id : null,
        translatedText,
        sourceLanguage: body.sourceLanguage,
        targetLanguage: body.targetLanguage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
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
