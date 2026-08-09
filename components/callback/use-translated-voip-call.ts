"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";

type VoipRole = "rider" | "support";
type VoipPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "recording"
  | "transcribing"
  | "translating"
  | "synthesizing"
  | "sending"
  | "receiving"
  | "error"
  | "ended";

type TranslationTurn = {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: "hi-IN" | "en-IN";
  targetLanguage: "hi-IN" | "en-IN";
  speaker: VoipRole;
};

type TokenResponse = {
  serverUrl: string;
  participantToken: string;
};

type ErrorPayload = { error?: { message?: unknown } };

const AUDIO_TOPIC = "translated-audio";
const META_TOPIC = "translation-meta";
const CONTROL_TOPIC = "translation-control";
const MAX_RECORDING_MS = 15_000;
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

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
  return "webm";
}

async function apiError(response: Response) {
  try {
    const body = (await response.json()) as ErrorPayload;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Use the generic message below.
  }
  return "The translated call could not continue. Please try again.";
}

async function jsonResponse<T>(response: Response) {
  if (!response.ok) throw new Error(await apiError(response));
  return (await response.json()) as T;
}

export function useTranslatedVoipCall(role: VoipRole) {
  const [phase, setPhase] = useState<VoipPhase>("idle");
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastTurn, setLastTurn] = useState<TranslationTurn | null>(null);

  const roomRef = useRef<Room | null>(null);
  const callbackIdRef = useRef("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const operationRef = useRef(0);

  const sourceLanguage = role === "support" ? "en-IN" : "hi-IN";
  const targetLanguage = role === "support" ? "hi-IN" : "en-IN";
  const peerIdentity = role === "support" ? "rider-R-108" : "support-demo";

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.removeAttribute("src");
      audio.load();
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
  }, []);

  const stopCapture = useCallback(() => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const primePlayback = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    audio.src = SILENT_WAV_DATA_URL;
    void audio.play().then(() => {
      if (audio.src !== SILENT_WAV_DATA_URL) return;
      audio.pause();
      audio.currentTime = 0;
    }).catch(() => undefined);
  }, []);

  const disconnect = useCallback(async () => {
    operationRef.current += 1;
    stopCapture();
    stopPlayback();
    const room = roomRef.current;
    roomRef.current = null;
    callbackIdRef.current = "";
    setPeerConnected(false);
    setConnected(false);
    if (room) await room.disconnect().catch(() => undefined);
    setPhase("ended");
  }, [stopCapture, stopPlayback]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const audio = audioRef.current;
      if (audio) audio.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
    };
  }, []);

  const connect = useCallback(async (callbackId: string) => {
    if (roomRef.current && callbackIdRef.current === callbackId) return true;
    const operation = ++operationRef.current;
    setPhase("connecting");
    setErrorMessage("");
    primePlayback();

    try {
      const { Room, RoomEvent } = await import("livekit-client");
      const token = await jsonResponse<TokenResponse>(
        await fetch(`/api/support/callbacks/${callbackId}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }),
      );
      if (operation !== operationRef.current) return false;

      const existing = roomRef.current;
      if (existing) await existing.disconnect().catch(() => undefined);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      callbackIdRef.current = callbackId;

      room.registerByteStreamHandler(AUDIO_TOPIC, (reader) => {
        void (async () => {
          try {
            stopPlayback();
            setPhase("receiving");
            const chunks = await reader.readAll();
            const audioParts = chunks.map((chunk) =>
              chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength,
              ) as ArrayBuffer,
            );
            const blob = new Blob(audioParts, {
              type: reader.info.mimeType || "audio/wav",
            });
            const audioUrl = URL.createObjectURL(blob);
            audioUrlRef.current = audioUrl;
            const audio = audioRef.current || new Audio();
            audioRef.current = audio;
            audio.src = audioUrl;
            audio.onended = () => {
              if (audioUrlRef.current === audioUrl) {
                URL.revokeObjectURL(audioUrl);
                audioUrlRef.current = "";
              }
              setPhase("ready");
            };
            await audio.play();
          } catch {
            setErrorMessage("Translated audio is ready, but playback was blocked. Tap the call once and retry.");
            setPhase("error");
          }
        })();
      });

      room.registerTextStreamHandler(META_TOPIC, (reader) => {
        void reader.readAll().then((text) => {
          try {
            setLastTurn(JSON.parse(text) as TranslationTurn);
          } catch {
            // Ignore malformed peer metadata while keeping the call alive.
          }
        });
      });

      room.registerTextStreamHandler(CONTROL_TOPIC, (reader) => {
        void reader.readAll().then((text) => {
          try {
            const control = JSON.parse(text) as { type?: string };
            if (control.type === "turn-start") {
              stopPlayback();
              setPhase("receiving");
            }
          } catch {
            // Ignore malformed peer control messages.
          }
        });
      });

      room.on(RoomEvent.ParticipantConnected, () => setPeerConnected(true));
      room.on(RoomEvent.ParticipantDisconnected, () => setPeerConnected(false));
      room.on(RoomEvent.Disconnected, () => {
        setPeerConnected(false);
        setConnected(false);
        setPhase("ended");
      });

      await room.connect(token.serverUrl, token.participantToken, { autoSubscribe: true });
      await room.startAudio().catch(() => undefined);
      if (operation !== operationRef.current) {
        await room.disconnect();
        return false;
      }
      setPeerConnected(room.remoteParticipants.size > 0);
      setConnected(true);
      setPhase("ready");
      return true;
    } catch (error) {
      if (operation !== operationRef.current) return false;
      setErrorMessage(
        error instanceof Error ? error.message : "Translated VoIP could not connect.",
      );
      setConnected(false);
      setPhase("error");
      return false;
    }
  }, [primePlayback, role, stopPlayback]);

  const processRecording = useCallback(async (blob: Blob) => {
    const room = roomRef.current;
    if (!room || room.state !== "connected") {
      setErrorMessage("The other person is no longer connected.");
      setPhase("error");
      return;
    }

    const operation = ++operationRef.current;
    try {
      setPhase("transcribing");
      const form = new FormData();
      const mimeType = blob.type || "audio/webm";
      form.append("audio", blob, `callback-turn.${fileExtension(mimeType)}`);
      form.append("languageCode", sourceLanguage);
      const transcription = await jsonResponse<{ transcript: string; languageCode: "hi-IN" | "en-IN" }>(
        await fetch("/api/local-translation/transcribe", { method: "POST", body: form }),
      );

      setPhase("translating");
      const translation = await jsonResponse<{ translatedText: string }>(
        await fetch("/api/local-translation/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: transcription.transcript,
            sourceLanguage,
            targetLanguage,
          }),
        }),
      );

      setPhase("synthesizing");
      const speech = await fetch("/api/local-translation/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: translation.translatedText, language: targetLanguage }),
      });
      if (!speech.ok) throw new Error(await apiError(speech));
      const audioBlob = await speech.blob();
      if (!audioBlob.size) throw new Error("No translated audio was returned.");

      const turn: TranslationTurn = {
        id: crypto.randomUUID(),
        sourceText: transcription.transcript,
        translatedText: translation.translatedText,
        sourceLanguage,
        targetLanguage,
        speaker: role,
      };
      setLastTurn(turn);
      setPhase("sending");
      await room.localParticipant.sendText(JSON.stringify(turn), {
        topic: META_TOPIC,
        destinationIdentities: [peerIdentity],
      });
      await room.localParticipant.sendBytes(
        new Uint8Array(await audioBlob.arrayBuffer()),
        {
          topic: AUDIO_TOPIC,
          name: `turn-${turn.id}.wav`,
          mimeType: "audio/wav",
          destinationIdentities: [peerIdentity],
        },
      );
      await room.localParticipant.sendText(
        JSON.stringify({ type: "turn-end", turnId: turn.id }),
        { topic: CONTROL_TOPIC, destinationIdentities: [peerIdentity] },
      );
      if (operation === operationRef.current) setPhase("ready");
    } catch (error) {
      if (operation !== operationRef.current) return;
      setErrorMessage(
        !navigator.onLine
          ? "You’re offline. Reconnect and try the turn again."
          : error instanceof Error
            ? error.message
            : "The translated turn could not be sent.",
      );
      setPhase("error");
    }
  }, [peerIdentity, role, sourceLanguage, targetLanguage]);

  const startRecording = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== "connected" || !peerConnected) {
      setErrorMessage("Wait for the other person to join before speaking.");
      setPhase("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("This browser cannot record a translated call.");
      setPhase("error");
      return;
    }

    stopPlayback();
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size > 250) void processRecording(blob);
        else {
          setErrorMessage("Speak a little longer so the message can be heard.");
          setPhase("error");
        }
      }, { once: true });

      await room.localParticipant.sendText(JSON.stringify({ type: "turn-start" }), {
        topic: CONTROL_TOPIC,
        destinationIdentities: [peerIdentity],
      });
      recorder.start(250);
      setPhase("recording");
      recordingTimerRef.current = setTimeout(() => stopCapture(), MAX_RECORDING_MS);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setErrorMessage(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Allow microphone access and try again."
          : "The microphone could not be opened.",
      );
      setPhase("error");
    }
  }, [peerConnected, peerIdentity, processRecording, stopCapture, stopPlayback]);

  const stopRecording = useCallback(() => {
    if (phase !== "recording") return;
    stopCapture();
  }, [phase, stopCapture]);

  const toggleRecording = useCallback(() => {
    if (phase === "recording") stopRecording();
    else if (phase === "ready" || phase === "error") void startRecording();
  }, [phase, startRecording, stopRecording]);

  return {
    phase,
    peerConnected,
    connected,
    errorMessage,
    lastTurn,
    connect,
    disconnect,
    toggleRecording,
  };
}
