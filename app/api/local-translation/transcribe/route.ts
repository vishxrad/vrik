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

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "video/webm",
]);

function normalizedMimeType(file: File) {
  return file.type.toLowerCase().split(";", 1)[0].trim();
}

export async function POST(request: Request) {
  const blocked = guardLocalTranslationRequest(request, "transcribe");
  if (blocked) return blocked;

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File) || audio.size === 0) {
      return jsonError(
        400,
        "INVALID_AUDIO",
        "Record a short message before translating.",
        false,
      );
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return jsonError(
        413,
        "PAYLOAD_TOO_LARGE",
        "Keep the recording under 15 seconds and 4 MB.",
        false,
      );
    }

    const audioMimeType = normalizedMimeType(audio);
    if (!ALLOWED_AUDIO_TYPES.has(audioMimeType)) {
      return jsonError(
        415,
        "INVALID_AUDIO",
        "This recording format is not supported. Try recording again.",
        false,
      );
    }

    const upstreamForm = new FormData();
    const upstreamAudio = new File([audio], audio.name || "recording.webm", {
      type: audioMimeType,
      lastModified: audio.lastModified,
    });
    upstreamForm.append("file", upstreamAudio, upstreamAudio.name);
    upstreamForm.append("model", "saaras:v3");
    upstreamForm.append("mode", "transcribe");

    const upstream = await sarvamFetch("speech-to-text", {
      method: "POST",
      body: upstreamForm,
    });
    if (upstream instanceof Response && upstream.status === 503) return upstream;

    const body = await parseSarvamJson(upstream);
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const languageCode = body.language_code;

    if (!transcript) {
      if ("transcript" in body) {
        return jsonError(
          422,
          "NO_SPEECH_DETECTED",
          "No clear speech was detected. Hold the button and try again.",
          true,
        );
      }
      return invalidSarvamResponse();
    }

    if (!isLocalLanguageCode(languageCode)) {
      if (typeof languageCode === "string") {
        return jsonError(
          422,
          "UNSUPPORTED_LANGUAGE",
          "The detected language is not supported yet. Try Tamil, Kannada, Hindi, or English.",
          false,
        );
      }
      return invalidSarvamResponse();
    }

    return Response.json(
      {
        requestId: typeof body.request_id === "string" ? body.request_id : null,
        transcript,
        languageCode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TypeError && error.message === "Invalid Sarvam response") {
      return invalidSarvamResponse();
    }
    return sarvamErrorResponse(error);
  }
}
