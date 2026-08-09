"use client";

import {
  Languages,
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
  Volume2,
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
type OtherLanguageCode = Exclude<LanguageCode, "ta-IN">;
type Direction = "rider" | "other";
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
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
};

type ApiErrorPayload = {
  error?: {
    message?: unknown;
  };
};

const RIDER_LANGUAGE: LanguageCode = "ta-IN";
const LANGUAGE_STORAGE_KEY = "local-translation.counterpart-language";
const MAX_RECORDING_MS = 15_000;

const languageNames: Record<LanguageCode, string> = {
  "ta-IN": "Tamil",
  "kn-IN": "Kannada",
  "hi-IN": "Hindi",
  "en-IN": "English",
};

const otherLanguages: Array<{ code: OtherLanguageCode; label: string; native: string }> = [
  { code: "hi-IN", label: "Hindi", native: "हिंदी" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "en-IN", label: "English", native: "English" },
];

const phaseLabels: Record<Phase, string> = {
  idle: "Ready to translate",
  "requesting-permission": "Opening microphone…",
  recording: "Listening… release when finished",
  transcribing: "Understanding speech…",
  translating: "Translating message…",
  speaking: "Playing translation…",
  ready: "Translation ready",
  error: "Translation stopped",
};

function isOtherLanguage(value: string | null): value is OtherLanguageCode {
  return otherLanguages.some((language) => language.code === value);
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
  const [otherLanguage, setOtherLanguage] =
    useState<OtherLanguageCode>("hi-IN");
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("hold");
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);
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
    direction: Direction;
    otherLanguage: OtherLanguageCode;
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
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isOtherLanguage(savedLanguage)) setOtherLanguage(savedLanguage);
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

  function stopPlayback({ revoke = false } = {}) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (revoke && audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
      setHasAudio(false);
    }
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
    setActiveDirection(null);
    setResult(null);
    setErrorMessage("");
    setPlaybackNotice("");
    setCanRetry(false);
    lastRecordingRef.current = null;
    setOpen(false);
  }

  function selectOtherLanguage(code: OtherLanguageCode) {
    setOtherLanguage(code);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
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
      formData.append("languageCode", recording.sourceLanguage);

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
      const translation = await jsonResponse<{ translatedText: string }>(
        await fetch("/api/local-translation/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: transcription.transcript,
            sourceLanguage: recording.sourceLanguage,
            targetLanguage: recording.targetLanguage,
          }),
          signal: controller.signal,
        }),
      );

      const nextResult: TranslationResult = {
        sourceText: transcription.transcript,
        translatedText: translation.translatedText,
        sourceLanguage: recording.sourceLanguage,
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
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setHasAudio(true);
      audio.addEventListener(
        "ended",
        () => {
          setPhase("ready");
        },
        { once: true },
      );

      setPhase("speaking");
      try {
        await audio.play();
      } catch {
        setPlaybackNotice("Tap Replay to hear the translated message.");
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
      setActiveDirection(null);
    }
  }

  async function startRecording(direction: Direction) {
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
    setActiveDirection(direction);
    setPhase("requesting-permission");
    requestControllerRef.current?.abort();
    stopPlayback({ revoke: true });

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
        setActiveDirection(null);
        return;
      }

      streamRef.current = stream;
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      activeTurnRef.current = { direction, otherLanguage };

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
            setActiveDirection(null);
            return;
          }

          const sourceLanguage =
            turn.direction === "rider" ? RIDER_LANGUAGE : turn.otherLanguage;
          const targetLanguage =
            turn.direction === "rider" ? turn.otherLanguage : RIDER_LANGUAGE;
          void processRecording({ blob, sourceLanguage, targetLanguage });
        },
        { once: true },
      );

      recorder.start(250);
      setPhase("recording");
      recordingTimerRef.current = setTimeout(() => {
        pressActiveRef.current = false;
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (error) {
      stopStream();
      setActiveDirection(null);
      setErrorMessage(
        error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? "Microphone access is off. Allow it in browser settings and try again."
          : "The microphone could not be opened. Please try again.",
      );
      setPhase("error");
    }
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, direction: Direction) {
    if (interactionMode !== "hold" || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressActiveRef.current = true;
    void startRecording(direction);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (interactionMode !== "hold") return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopRecording();
  }

  function onKeyboardDown(event: KeyboardEvent<HTMLButtonElement>, direction: Direction) {
    if (
      interactionMode !== "hold" ||
      event.repeat ||
      (event.key !== " " && event.key !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    pressActiveRef.current = true;
    void startRecording(direction);
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

  function onTap(direction: Direction) {
    if (interactionMode !== "tap") return;
    if (phase === "recording" && activeDirection === direction) {
      stopRecording();
      return;
    }
    if (!busy) {
      pressActiveRef.current = true;
      void startRecording(direction);
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

  function recordingButton(direction: Direction) {
    const rider = direction === "rider";
    const active = phase === "recording" && activeDirection === direction;
    const disabled = busy && !active;
    const title = rider
      ? "Ram speaks Tamil"
      : `Other person speaks ${languageNames[otherLanguage]}`;
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
        className={`translation-talk-button ${rider ? "rider" : "other"} ${active ? "recording" : ""}`}
        disabled={disabled}
        aria-label={`${helper}. ${title}.`}
        aria-pressed={active}
        onPointerDown={(event) => onPointerDown(event, direction)}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onKeyboardDown(event, direction)}
        onKeyUp={onKeyboardUp}
        onClick={() => onTap(direction)}
      >
        <span className="translation-talk-icon">
          {active ? <Volume2 size={24} /> : <Mic size={24} />}
        </span>
        <span>
          <strong>{title}</strong>
          <small>{helper}</small>
        </span>
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
          <Languages size={21} />
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
                <span className="translation-eyebrow">Local translation</span>
                <h2 id="translation-title">Speak. Hear. Continue.</h2>
                <p>No typing and no language detection.</p>
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

            <div className="translation-language-block">
              <div className="translation-language-heading">
                <span>Other person speaks</span>
                <strong>{languageNames[otherLanguage]}</strong>
              </div>
              <div className="translation-language-options" aria-label="Other person’s language">
                {otherLanguages.map((language) => (
                  <button
                    type="button"
                    key={language.code}
                    className={otherLanguage === language.code ? "selected" : ""}
                    aria-pressed={otherLanguage === language.code}
                    disabled={busy}
                    onClick={() => selectOtherLanguage(language.code)}
                  >
                    <strong>{language.native}</strong>
                    <small>{language.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="translation-mode-row">
              <span>{interactionMode === "hold" ? "Hold mode" : "Tap mode"}</span>
              <button
                type="button"
                aria-pressed={interactionMode === "tap"}
                disabled={busy}
                onClick={() =>
                  setInteractionMode((current) => (current === "hold" ? "tap" : "hold"))
                }
              >
                {interactionMode === "hold" ? "Prefer tapping?" : "Use press and hold"}
              </button>
            </div>

            <div className="translation-talk-grid">
              {recordingButton("rider")}
              <div className="translation-direction" aria-hidden="true">
                <span>Tamil</span>
                <i>⇄</i>
                <span>{languageNames[otherLanguage]}</span>
              </div>
              {recordingButton("other")}
            </div>

            <div className={`translation-status ${phase}`} aria-live="polite">
              {busy && phase !== "recording" ? (
                <LoaderCircle className="translation-spinner" size={17} />
              ) : phase === "recording" ? (
                <span className="translation-live-dot" />
              ) : null}
              <span>{phaseLabels[phase]}</span>
            </div>

            {result && (
              <div className="translation-result">
                <div>
                  <small>You heard • {languageNames[result.sourceLanguage]}</small>
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
