"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Mic, MicOff, Phone, PhoneCall, PhoneOff, Volume2 } from "lucide-react";

import styles from "@/components/callback/callback-ui.module.css";
import { useLivekitAudioCall } from "@/components/callback/use-livekit-audio-call";
import {
  openCallbackDemoChannel,
  publishCallbackDemoEvent,
} from "@/lib/callback-demo-channel";
import {
  DEMO_CALLBACK,
  type CallbackApiRecord,
  type CallbackDemoEvent,
} from "@/lib/callback-demo";

type RiderCallState = "hidden" | "incoming" | "connected";

export function RiderCallbackCall({ onIncoming }: { onIncoming?: () => void }) {
  const [state, setState] = useState<RiderCallState>("hidden");
  const callbackIdRef = useRef("");
  const call = useLivekitAudioCall("rider");
  const disconnectCall = call.disconnect;

  const pollForCallback = useCallback(async () => {
    try {
      const response = await fetch("/api/support/callbacks/current", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { callback: CallbackApiRecord | null };
      const callback = body.callback;
      if (!callback) {
        if (callbackIdRef.current) {
          setState("hidden");
          void disconnectCall();
        }
        callbackIdRef.current = "";
        return;
      }
      callbackIdRef.current = callback.id;
      if (callback.status === "ringing") {
        setState((current) => (current === "hidden" ? "incoming" : current));
        onIncoming?.();
      }
      if (callback.status === "connected") {
        setState((current) => (current === "hidden" || current === "incoming" ? "connected" : current));
      }
    } catch {
      // Same-browser ringing remains available if polling is briefly interrupted.
    }
  }, [disconnectCall, onIncoming]);

  useEffect(() => {
    const channel = openCallbackDemoChannel((event: CallbackDemoEvent) => {
      if (event.type === "ring") {
        callbackIdRef.current = event.callbackId || "";
        setState("incoming");
        onIncoming?.();
      }
      if (event.type === "end") {
        setState("hidden");
        void disconnectCall();
      }
    });
    return () => channel?.close();
  }, [disconnectCall, onIncoming]);

  useEffect(() => {
    const initial = window.setTimeout(() => void pollForCallback(), 0);
    const interval = window.setInterval(() => void pollForCallback(), 2_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [pollForCallback]);

  async function answer() {
    if (!callbackIdRef.current) return;
    const response = await fetch(
      `/api/support/callbacks/${callbackIdRef.current}/accept`,
      { method: "POST" },
    ).catch(() => null);
    if (!response || !response.ok) return;

    setState("connected");
    await call.connect(callbackIdRef.current);
    publishCallbackDemoEvent({
      type: "accept",
      at: Date.now(),
      callbackId: callbackIdRef.current,
    });
  }

  async function reconnectAudio() {
    if (!callbackIdRef.current) return;
    await call.connect(callbackIdRef.current);
  }

  async function decline() {
    if (callbackIdRef.current) {
      await fetch(`/api/support/callbacks/${callbackIdRef.current}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "declined" }),
      }).catch(() => undefined);
    }
    setState("hidden");
    await call.disconnect();
    publishCallbackDemoEvent({
      type: "decline",
      at: Date.now(),
      callbackId: callbackIdRef.current || undefined,
    });
    callbackIdRef.current = "";
  }

  async function endCall() {
    if (callbackIdRef.current) {
      await fetch(`/api/support/callbacks/${callbackIdRef.current}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "completed" }),
      }).catch(() => undefined);
    }
    setState("hidden");
    await call.disconnect();
    publishCallbackDemoEvent({
      type: "end",
      at: Date.now(),
      callbackId: callbackIdRef.current || undefined,
    });
    callbackIdRef.current = "";
  }

  if (state === "hidden") return null;

  const statusText =
    call.errorMessage ||
    (call.phase === "connecting"
      ? "Joining the audio room…"
      : call.peerSpeaking
        ? "Support is speaking"
        : call.connected && !call.peerConnected
          ? "Connected · waiting for support"
          : call.connected && call.muted
            ? "Your microphone is muted"
            : call.connected
              ? "Live call · your microphone is on"
              : "Audio is disconnected");

  return (
    <div className={styles.riderOverlay} role="presentation">
      <section className={styles.riderSheet} role="dialog" aria-modal="true" aria-labelledby="rider-callback-title">
        <div className={styles.sheetHandle} aria-hidden="true" />
        <span className={styles.incomingLabel}>{state === "incoming" ? "Incoming support callback" : "Live support call"}</span>
        <h2 id="rider-callback-title">{DEMO_CALLBACK.support.name}</h2>
        <p>Order #{DEMO_CALLBACK.order.id} · {DEMO_CALLBACK.issue.type}</p>
        <div className={styles.languageNotice}>
          <PhoneCall size={15} /> Normal live audio. Both people can speak at any time.
        </div>

        {state === "incoming" ? (
          <div className={styles.incomingControls}>
            <button className={styles.declineButton} onClick={decline}><PhoneOff size={18} /> Decline</button>
            <button className={styles.acceptButton} onClick={answer}><Phone size={18} /> Answer</button>
          </div>
        ) : (
          <>
            <div className={styles.riderCallStatus} role="status" aria-live="polite">
              {call.peerSpeaking ? <Volume2 size={18} /> : <Headphones size={18} />}
              <span>{statusText}</span>
            </div>

            <div className={styles.liveCallControls}>
              <button
                type="button"
                className={`${styles.micControl} ${call.muted ? styles.muted : ""}`}
                onClick={() => void call.toggleMuted()}
                disabled={!call.connected || call.changingMicrophone}
                aria-pressed={call.muted}
              >
                {call.muted ? <MicOff size={25} /> : <Mic size={25} />}
                <span>{call.muted ? "Unmute" : "Mute"}</span>
              </button>
              <button className={styles.hangupControl} onClick={endCall}>
                <PhoneOff size={25} /><span>End</span>
              </button>
            </div>

            {!call.connected && (
              <button className={styles.secondaryAction} onClick={reconnectAudio}>
                Reconnect audio
              </button>
            )}
            {call.audioPlaybackBlocked && (
              <button className={styles.secondaryAction} onClick={() => void call.resumeAudio()}>
                Enable speaker audio
              </button>
            )}

            <div className={styles.hint}><PhoneCall size={14} /> LiveKit audio · no translation</div>
          </>
        )}
      </section>
    </div>
  );
}
