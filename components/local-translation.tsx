"use client";

import {
  AudioLines,
  Languages,
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type LanguageCode = "ta-IN" | "kn-IN" | "hi-IN" | "en-IN";
type InteractionMode = "hold" | "tap";
type Phase =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "transcribing"
  | "translating"
  | "speaking"
  | "ready"
  | "error";

type TranslationResult = {
  sourceText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
};

type SavedRecording = {
  blob: Blob;
  targetLanguage: LanguageCode;
};

type ApiErrorPayload = {
  error?: {
    message?: unknown;
  };
};

const DEFAULT_OUTPUT_LANGUAGE: LanguageCode = "kn-IN";
const OUTPUT_LANGUAGE_STORAGE_KEY = "local-translation.counterpart-language";
const MAX_RECORDING_MS = 15_000;
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

const languageNames: Record<LanguageCode, string> = {
  "ta-IN": "Tamil",
  "kn-IN": "Kannada",
  "hi-IN": "Hindi",
  "en-IN": "English",
};

const languages: Array<{ code: LanguageCode; label: string; native: string }> = [
  { code: "ta-IN", label: "Tamil", native: "தமிழ்" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "hi-IN", label: "Hindi", native: "हिंदी" },
  { code: "en-IN", label: "English", native: "English" },
];

const phaseLabels: Record<Phase, string> = {
  idle: "Ready to translate",
  "requesting-permission": "Opening microphone…",
  recording: "Listening…",
  transcribing: "Understanding speech…",
  translating: "Translating message…",
  speaking: "Playing translation…",
  ready: "Translation ready",
  error: "Translation stopped",
};

function isLanguageCode(value: string | null): value is LanguageCode {
  return languages.some((language) => language.code === value);
}

function preferredRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  return (
    ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ""
  );
}

function fileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function hapticFeedback(pattern: number | number[]) {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

async function apiErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as ApiErrorPayload;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // A non-JSON upstream failure falls back to the message below.
  }
  return "Translation could not be completed. Please try again.";
}

async function jsonResponse<T>(response: Response) {
  if (!response.ok) throw new Error(await apiErrorMessage(response));
  return (await response.json()) as T;
}

export function LocalTranslation() {
  const [open, setOpen] = useState(false);
  const [outputLanguage, setOutputLanguage] =
    useState<LanguageCode>(DEFAULT_OUTPUT_LANGUAGE);
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("hold");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [playbackNotice, setPlaybackNotice] = useState("");
  const [hasAudio, setHasAudio] = useState(false);
  const [canRetry, setCanRetry] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressActiveRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const captureSequenceRef = useRef(0);
  const activeTurnRef = useRef<{
    targetLanguage: LanguageCode;
  } | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const lastRecordingRef = useRef<SavedRecording | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const busy = useMemo(
    () =>
      [
        "requesting-permission",
        "recording",
        "transcribing",
        "translating",
        "speaking",
      ].includes(phase),
    [phase],
  );
  const controlsLocked = useMemo(
    () =>
      [
        "requesting-permission",
        "recording",
        "transcribing",
        "translating",
      ].includes(phase),
    [phase],
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeButtonRef.current?.click();
    };
    window.addEventListener("keydown", onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  });

  useEffect(() => {
    return () => {
      captureSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  function openSheet() {
    const savedOutputLanguage = window.localStorage.getItem(
      OUTPUT_LANGUAGE_STORAGE_KEY,
    );
    setOutputLanguage(
      isLanguageCode(savedOutputLanguage)
        ? savedOutputLanguage
        : DEFAULT_OUTPUT_LANGUAGE,
    );
    setOpen(true);
  }

  function clearRecordingTimer() {
    if (!recordingTimerRef.current) return;
    clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function playbackElement() {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
    }
    return audioRef.current;
  }

  function stopPlayback({ revoke = false } = {}) {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (audio.currentSrc) audio.currentTime = 0;
    }
    if (revoke) {
      if (audio) {
        audio.onended = null;
        audio.removeAttribute("src");
        audio.load();
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
      setHasAudio(false);
    }
  }

  function primeAudioPlayback() {
    const audio = playbackElement();
    audio.onended = null;
    audio.src = SILENT_WAV_DATA_URL;
    audio.load();
    void audio
      .play()
      .then(() => {
        if (audio.src !== SILENT_WAV_DATA_URL) return;
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {
        // The generated clip will still attempt normal autoplay and offer Replay.
      });
  }

  function interruptPlayback() {
    if (phase !== "speaking") return;
    stopPlayback();
    setPlaybackNotice("");
    setPhase(result ? "ready" : "idle");
  }

  function stopRecording() {
    pressActiveRef.current = false;
    clearRecordingTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function closeSheet() {
    discardRecordingRef.current = true;
    captureSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    stopRecording();
    stopStream();
    stopPlayback({ revoke: true });
    setPhase("idle");
    setResult(null);
    setErrorMessage("");
    setPlaybackNotice("");
    setCanRetry(false);
    lastRecordingRef.current = null;
    setOpen(false);
  }

  function selectOutputLanguage(code: LanguageCode) {
    interruptPlayback();
    setOutputLanguage(code);
    window.localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, code);
  }

  async function processRecording(recording: SavedRecording) {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    lastRecordingRef.current = recording;
    setCanRetry(true);
    setErrorMessage("");
    setPlaybackNotice("");
    setResult(null);
    stopPlayback({ revoke: true });

    try {
      setPhase("transcribing");
      const formData = new FormData();
      const mimeType = recording.blob.type || "audio/webm";
      formData.append(
        "audio",
        recording.blob,
        `local-turn.${fileExtension(mimeType)}`,
      );

      const transcription = await jsonResponse<{
        transcript: string;
        languageCode: LanguageCode;
      }>(
        await fetch("/api/local-translation/transcribe", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }),
      );

      setPhase("translating");
      const translation =
        transcription.languageCode === recording.targetLanguage
          ? { translatedText: transcription.transcript }
          : await jsonResponse<{ translatedText: string }>(
              await fetch("/api/local-translation/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: transcription.transcript,
                  sourceLanguage: transcription.languageCode,
                  targetLanguage: recording.targetLanguage,
                }),
                signal: controller.signal,
              }),
            );

      const nextResult: TranslationResult = {
        sourceText: transcription.transcript,
        translatedText: translation.translatedText,
        sourceLanguage: transcription.languageCode,
        targetLanguage: recording.targetLanguage,
      };
      setResult(nextResult);

      const speechResponse = await fetch("/api/local-translation/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: translation.translatedText,
          language: recording.targetLanguage,
        }),
        signal: controller.signal,
      });
      if (!speechResponse.ok) throw new Error(await apiErrorMessage(speechResponse));

      const audioBlob = await speechResponse.blob();
      if (!audioBlob.size) throw new Error("No translated audio was returned.");

      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;
      const audio = playbackElement();
      audio.src = audioUrl;
      audio.load();
      setHasAudio(true);
      audio.onended = () => setPhase("ready");

      setPhase("speaking");
      try {
        await audio.play();
      } catch {
        setPlaybackNotice("Audio is ready. Tap Replay to hear it.");
        setPhase("ready");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorMessage(
        !navigator.onLine
          ? "You’re offline. Reconnect and try again."
          : error instanceof Error
            ? error.message
            : "Translation could not be completed. Please try again.",
      );
      setPhase("error");
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }

  async function startRecording() {
    if (busy || !open) return;
    if (!navigator.onLine) {
      setErrorMessage("You’re offline. Reconnect before translating.");
      setPhase("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("This browser does not support microphone recording.");
      setPhase("error");
      return;
    }

    discardRecordingRef.current = false;
    const sequence = ++captureSequenceRef.current;
    setErrorMessage("");
    setPlaybackNotice("");
    setResult(null);
    setCanRetry(false);
    lastRecordingRef.current = null;
    setPhase("requesting-permission");
    requestControllerRef.current?.abort();
    stopPlayback({ revoke: true });
    primeAudioPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (
        sequence !== captureSequenceRef.current ||
        (interactionMode === "hold" && !pressActiveRef.current)
      ) {
        stream.getTracks().forEach((track) => track.stop());
        setPhase("idle");
        return;
      }

      streamRef.current = stream;
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      activeTurnRef.current = { targetLanguage: outputLanguage };

      recorder.addEventListener(
        "start",
        () => {
          recordingStartedAtRef.current = Date.now();
        },
        { once: true },
      );

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.addEventListener(
        "stop",
        () => {
          clearRecordingTimer();
          stopStream();
          recorderRef.current = null;
          const duration = Date.now() - recordingStartedAtRef.current;
          const turn = activeTurnRef.current;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || "audio/webm",
          });
          chunksRef.current = [];

          if (discardRecordingRef.current || !turn) return;
          if (duration < 350 || blob.size < 250) {
            setErrorMessage("Hold a little longer so the message can be heard.");
            setPhase("error");
            return;
          }

          void processRecording({ blob, targetLanguage: turn.targetLanguage });
        },
        { once: true },
      );

      recorder.start(250);
      setPhase("recording");
      recordingTimerRef.current = setTimeout(() => {
        hapticFeedback([16, 40, 16]);
        pressActiveRef.current = false;
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (error) {
      stopStream();
      setErrorMessage(
        error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? "Microphone access is off. Allow it in browser settings and try again."
          : "The microphone could not be opened. Please try again.",
      );
      setPhase("error");
    }
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (interactionMode !== "hold" || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    hapticFeedback(12);
    pressActiveRef.current = true;
    void startRecording();
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (interactionMode !== "hold") return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pressActiveRef.current) hapticFeedback(8);
    stopRecording();
  }

  function onKeyboardDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      interactionMode !== "hold" ||
      event.repeat ||
      (event.key !== " " && event.key !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    pressActiveRef.current = true;
    void startRecording();
  }

  function onKeyboardUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      interactionMode !== "hold" ||
      (event.key !== " " && event.key !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    stopRecording();
  }

  function onTap() {
    if (interactionMode !== "tap") return;
    if (phase === "recording") {
      hapticFeedback([8, 24, 8]);
      stopRecording();
      return;
    }
    if (!busy) {
      hapticFeedback(12);
      pressActiveRef.current = true;
      void startRecording();
    }
  }

  async function replay() {
    const audio = audioRef.current;
    if (!audio) return;
    setPlaybackNotice("");
    audio.currentTime = 0;
    setPhase("speaking");
    try {
      await audio.play();
    } catch {
      setPlaybackNotice("Audio playback is blocked by this browser.");
      setPhase("ready");
    }
  }

  function retry() {
    if (lastRecordingRef.current && !busy) {
      void processRecording(lastRecordingRef.current);
    }
  }

  function recordingButton() {
    const active = phase === "recording";
    const disabled =
      busy && phase !== "requesting-permission" && phase !== "recording";
    const title = `Input language is detected automatically. Output is ${languageNames[outputLanguage]}`;
    const helper =
      interactionMode === "hold"
        ? active
          ? "Release when finished"
          : "Press and hold to speak"
        : active
          ? "Tap again to finish"
          : "Tap to start speaking";

    return (
      <button
        type="button"
        className={`translation-talk-button ${active ? "recording" : ""}`}
        disabled={disabled}
        aria-label={`${helper}. ${title}.`}
        aria-pressed={active}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyboardDown}
        onKeyUp={onKeyboardUp}
        onClick={onTap}
      >
        <span className="translation-talk-icon">
          {active ? <AudioLines size={38} /> : <Mic size={38} />}
        </span>
        <strong>{active ? "Listening" : interactionMode === "hold" ? "Hold to speak" : "Tap to speak"}</strong>
        <small>{active ? helper : "Language detected automatically"}</small>
      </button>
    );
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="translation-fab"
          onClick={openSheet}
          aria-label="Open local language translation"
        >
          <Languages size={23} />
          <span>Translate</span>
        </button>
      )}

      {open && (
        <div
          className="translation-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
        >
          <section
            className="translation-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="translation-title"
          >
            <div className="translation-sheet-handle" aria-hidden="true" />
            <header className="translation-sheet-header">
              <div>
                <span className="translation-eyebrow">Quick translation</span>
                <h2 id="translation-title">Speak to translate</h2>
                <p>We’ll detect the spoken language automatically.</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="translation-close"
                onClick={closeSheet}
                aria-label="Close translation"
              >
                <X size={20} />
              </button>
            </header>

            <div className="translation-language-settings">
              <label className="translation-language-row">
                <span>Select output language</span>
                <select
                  value={outputLanguage}
                  disabled={controlsLocked}
                  aria-label="Select output language"
                  onChange={(event) => {
                    if (isLanguageCode(event.target.value)) {
                      selectOutputLanguage(event.target.value);
                    }
                  }}
                >
                  {languages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.native} · {language.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="translation-talk-stage">
              <div className="translation-direction" aria-hidden="true">
                <span>Auto-detect</span>
                <i>→</i>
                <span>{languageNames[outputLanguage]}</span>
              </div>
              {recordingButton()}
            </div>

            <div className={`translation-status ${phase}`} aria-live="polite">
              {busy && phase !== "recording" ? (
                <LoaderCircle className="translation-spinner" size={17} />
              ) : phase === "recording" ? (
                <span className="translation-live-dot" />
              ) : null}
              <span>
                {phase === "recording"
                  ? interactionMode === "hold"
                    ? "Listening… release when finished"
                    : "Listening… tap again when finished"
                  : phaseLabels[phase]}
              </span>
            </div>

            <div className="translation-mode-row">
              <span>{interactionMode === "hold" ? "Press-and-hold mode" : "Tap mode"}</span>
              <button
                type="button"
                aria-pressed={interactionMode === "tap"}
                disabled={busy}
                onClick={() =>
                  setInteractionMode((current) => (current === "hold" ? "tap" : "hold"))
                }
              >
                {interactionMode === "hold" ? "Use tap instead" : "Use press and hold"}
              </button>
            </div>

            {result && (
              <div className="translation-result">
                <div>
                  <small>Original • {languageNames[result.sourceLanguage]}</small>
                  <p>{result.sourceText}</p>
                </div>
                <div className="translated">
                  <small>Translated • {languageNames[result.targetLanguage]}</small>
                  <p>{result.translatedText}</p>
                </div>
                <div className="translation-result-actions">
                  <button type="button" onClick={() => void replay()} disabled={!hasAudio}>
                    <Play size={16} fill="currentColor" /> Replay
                  </button>
                  <button type="button" onClick={retry} disabled={busy || !canRetry}>
                    <RotateCcw size={16} /> Retry
                  </button>
                </div>
              </div>
            )}

            {(errorMessage || playbackNotice) && (
              <div className={`translation-message ${errorMessage ? "error" : "notice"}`} role="alert">
                <span>{errorMessage || playbackNotice}</span>
                {errorMessage && canRetry && (
                  <button type="button" onClick={retry} disabled={busy}>
                    Try again
                  </button>
                )}
              </div>
            )}

            <p className="translation-privacy">Audio is translated live and is not saved.</p>
          </section>
        </div>
      )}
    </>
  );
}
