"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteTrack, Room } from "livekit-client";

type CallRole = "rider" | "support";
type CallPhase = "idle" | "connecting" | "connected" | "error" | "ended";

type TokenResponse = {
  serverUrl: string;
  participantToken: string;
};

type ErrorPayload = { error?: { message?: unknown } };

async function apiError(response: Response) {
  try {
    const body = (await response.json()) as ErrorPayload;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Use the generic message below.
  }
  return "The audio call could not connect. Please try again.";
}

async function jsonResponse<T>(response: Response) {
  if (!response.ok) throw new Error(await apiError(response));
  return (await response.json()) as T;
}

function readableMediaError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Microphone access is required for this call. Allow it and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
  }
  return error instanceof Error ? error.message : "The audio call could not connect.";
}

export function useLivekitAudioCall(role: CallRole) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [peerSpeaking, setPeerSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [changingMicrophone, setChangingMicrophone] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const roomRef = useRef<Room | null>(null);
  const callbackIdRef = useRef("");
  const operationRef = useRef(0);
  const audioElementsRef = useRef(new Set<HTMLMediaElement>());

  const removeAudioElements = useCallback(() => {
    for (const element of audioElementsRef.current) {
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    audioElementsRef.current.clear();
  }, []);

  const attachRemoteAudio = useCallback((track: RemoteTrack) => {
    if (track.kind !== "audio") return;
    const element = track.attach();
    element.autoplay = true;
    element.setAttribute("playsinline", "");
    element.dataset.callbackAudio = "true";
    element.style.display = "none";
    document.body.appendChild(element);
    audioElementsRef.current.add(element);
  }, []);

  const detachRemoteAudio = useCallback((track: RemoteTrack) => {
    for (const element of track.detach()) {
      audioElementsRef.current.delete(element);
      element.pause();
      element.srcObject = null;
      element.remove();
    }
  }, []);

  const disconnect = useCallback(async () => {
    operationRef.current += 1;
    const room = roomRef.current;
    roomRef.current = null;
    callbackIdRef.current = "";
    setConnected(false);
    setPeerConnected(false);
    setPeerSpeaking(false);
    setMuted(false);
    setChangingMicrophone(false);
    setAudioPlaybackBlocked(false);
    removeAudioElements();
    if (room) await room.disconnect().catch(() => undefined);
    setPhase("ended");
  }, [removeAudioElements]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      removeAudioElements();
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
    };
  }, [removeAudioElements]);

  const connect = useCallback(async (callbackId: string) => {
    if (
      roomRef.current?.state === "connected" &&
      callbackIdRef.current === callbackId
    ) {
      return true;
    }

    const operation = ++operationRef.current;
    setPhase("connecting");
    setErrorMessage("");
    setAudioPlaybackBlocked(false);

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
      roomRef.current = null;
      if (existing) await existing.disconnect().catch(() => undefined);
      removeAudioElements();

      const room = new Room();
      roomRef.current = room;
      callbackIdRef.current = callbackId;

      room.on(RoomEvent.TrackSubscribed, (track) => attachRemoteAudio(track));
      room.on(RoomEvent.TrackUnsubscribed, (track) => detachRemoteAudio(track));
      room.on(RoomEvent.ParticipantConnected, () => {
        if (roomRef.current !== room) return;
        setPeerConnected(room.remoteParticipants.size > 0);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (roomRef.current !== room) return;
        setPeerConnected(room.remoteParticipants.size > 0);
        setPeerSpeaking(false);
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (participants) => {
        if (roomRef.current !== room) return;
        setPeerSpeaking(
          participants.some(
            (participant) => participant.identity !== room.localParticipant.identity,
          ),
        );
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (roomRef.current !== room) return;
        setAudioPlaybackBlocked(!room.canPlaybackAudio);
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (roomRef.current === room) setPhase("connecting");
      });
      room.on(RoomEvent.Reconnected, () => {
        if (roomRef.current === room) setPhase("connected");
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        roomRef.current = null;
        callbackIdRef.current = "";
        removeAudioElements();
        setConnected(false);
        setPeerConnected(false);
        setPeerSpeaking(false);
        setPhase("ended");
      });

      await room.connect(token.serverUrl, token.participantToken, {
        autoSubscribe: true,
      });
      await room.startAudio().catch(() => setAudioPlaybackBlocked(true));
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

      if (operation !== operationRef.current) {
        await room.disconnect();
        return false;
      }

      setPeerConnected(room.remoteParticipants.size > 0);
      setMuted(false);
      setConnected(true);
      setPhase("connected");
      return true;
    } catch (error) {
      if (operation !== operationRef.current) return false;
      const room = roomRef.current;
      roomRef.current = null;
      callbackIdRef.current = "";
      if (room) await room.disconnect().catch(() => undefined);
      removeAudioElements();
      setErrorMessage(readableMediaError(error));
      setConnected(false);
      setPeerConnected(false);
      setPeerSpeaking(false);
      setPhase("error");
      return false;
    }
  }, [attachRemoteAudio, detachRemoteAudio, removeAudioElements, role]);

  const toggleMuted = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== "connected" || changingMicrophone) return;

    const nextMuted = !muted;
    setChangingMicrophone(true);
    setErrorMessage("");
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      setMuted(nextMuted);
    } catch (error) {
      setErrorMessage(readableMediaError(error));
      setPhase("error");
    } finally {
      setChangingMicrophone(false);
    }
  }, [changingMicrophone, muted]);

  const resumeAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setAudioPlaybackBlocked(false);
      setErrorMessage("");
    } catch {
      setAudioPlaybackBlocked(true);
      setErrorMessage("Tap enable audio so you can hear the other person.");
    }
  }, []);

  return {
    phase,
    connected,
    peerConnected,
    peerSpeaking,
    muted,
    changingMicrophone,
    audioPlaybackBlocked,
    errorMessage,
    connect,
    disconnect,
    toggleMuted,
    resumeAudio,
  };
}
