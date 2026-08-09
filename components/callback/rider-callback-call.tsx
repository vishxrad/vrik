"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Headphones, Languages, Mic, Phone, PhoneOff, Volume2 } from "lucide-react";

import styles from "@/components/callback/callback-ui.module.css";
import {
  usePressToTalk,
  type PressToTalkMode,
} from "@/components/callback/use-press-to-talk";
import { useTranslatedVoipCall } from "@/components/callback/use-translated-voip-call";
import {
  openCallbackDemoChannel,
  publishCallbackDemoEvent,
} from "@/lib/callback-demo-channel";
import {
  DEMO_CALLBACK,
  type CallbackApiRecord,
  type CallbackDemoEvent,
} from "@/lib/callback-demo";

type RiderCallState = "hidden" | "incoming" | "connected" | "support-speaking" | "recording";

export function RiderCallbackCall({ onIncoming }: { onIncoming?: () => void }) {
  const [state, setState] = useState<RiderCallState>("hidden");
  const [interactionMode, setInteractionMode] =
    useState<PressToTalkMode>("hold");
  const callbackIdRef = useRef("");
  const fallbackRecordingRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voip = useTranslatedVoipCall("rider");

  const pollForCallback = useCallback(async () => {
    try {
      const response = await fetch("/api/support/callbacks/current", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { callback: CallbackApiRecord | null };
      const callback = body.callback;
      if (!callback) {
        if (callbackIdRef.current) setState("hidden");
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
      // The BroadcastChannel preview remains available without a database.
    }
  }, [onIncoming]);

  useEffect(() => {
    const channel = openCallbackDemoChannel((event: CallbackDemoEvent) => {
      if (event.type === "ring") {
        callbackIdRef.current = event.callbackId || "";
        setState("incoming");
        onIncoming?.();
      }
      if (event.type === "turn-start" && event.speaker === "support") {
        setState("support-speaking");
      }
      if (event.type === "turn-end" && event.speaker === "support") {
        setState("connected");
      }
      if (event.type === "end") setState("hidden");
    });
    return () => channel?.close();
  }, [onIncoming]);

  useEffect(() => {
    const initial = window.setTimeout(() => void pollForCallback(), 0);
    const interval = window.setInterval(() => void pollForCallback(), 2_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [pollForCallback]);

  useEffect(() => () => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
  }, []);

  async function answer() {
    if (callbackIdRef.current) {
      const response = await fetch(
        `/api/support/callbacks/${callbackIdRef.current}/accept`,
        { method: "POST" },
      ).catch(() => null);
      if (response && !response.ok) return;
    }
    if (callbackIdRef.current) await voip.connect(callbackIdRef.current);
    setState("connected");
    publishCallbackDemoEvent({
      type: "accept",
      at: Date.now(),
      callbackId: callbackIdRef.current || undefined,
    });
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
    await voip.disconnect();
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
    await voip.disconnect();
    publishCallbackDemoEvent({
      type: "end",
      at: Date.now(),
      callbackId: callbackIdRef.current || undefined,
    });
    callbackIdRef.current = "";
  }

  function finishFallbackTurn() {
    if (!fallbackRecordingRef.current) return;
    fallbackRecordingRef.current = false;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    setState("connected");
    publishCallbackDemoEvent({ type: "turn-end", speaker: "rider", at: Date.now() });
  }

  function startRiderTurn() {
    if (voip.connected) {
      void voip.startRecording();
      return;
    }
    if (state !== "connected") return;
    fallbackRecordingRef.current = true;
    setState("recording");
    publishCallbackDemoEvent({ type: "turn-start", speaker: "rider", at: Date.now() });
    fallbackTimerRef.current = setTimeout(finishFallbackTurn, 15_000);
  }

  function stopRiderTurn() {
    if (voip.connected) {
      voip.stopRecording();
      return;
    }
    finishFallbackTurn();
  }

  const supportSpeaking = voip.phase === "receiving" || state === "support-speaking";
  const riderRecording = voip.phase === "recording" || state === "recording";
  const voipBusy = ["transcribing", "translating", "synthesizing", "sending"].includes(voip.phase);
  const talkDisabled = supportSpeaking || voipBusy || (voip.connected && !voip.peerConnected);
  const pressToTalk = usePressToTalk({
    mode: interactionMode,
    disabled: talkDisabled,
    recording: riderRecording,
    start: startRiderTurn,
    stop: stopRiderTurn,
  });

  if (state === "hidden") return null;

  return (
    <div className={styles.riderOverlay} role="presentation">
      <section className={styles.riderSheet} role="dialog" aria-modal="true" aria-labelledby="rider-callback-title">
        <div className={styles.sheetHandle} aria-hidden="true" />
        <span className={styles.incomingLabel}>{state === "incoming" ? "Incoming support callback" : "Translated support call"}</span>
        <h2 id="rider-callback-title">{DEMO_CALLBACK.support.name}</h2>
        <p>Order #{DEMO_CALLBACK.order.id} · {DEMO_CALLBACK.issue.type}</p>
        <div className={styles.languageNotice}>
          <Languages size={15} /> Support speaks English. You hear and reply in Hindi.
        </div>

        {state === "incoming" ? (
          <div className={styles.incomingControls}>
            <button className={styles.declineButton} onClick={decline}><PhoneOff size={18} /> Decline</button>
            <button className={styles.acceptButton} onClick={answer}><Phone size={18} /> Answer</button>
          </div>
        ) : (
          <>
            <button
              className={`${styles.riderTalk} ${riderRecording ? styles.recording : ""}`}
              {...pressToTalk}
              disabled={talkDisabled}
              aria-pressed={riderRecording}
            >
              {supportSpeaking ? <Volume2 size={34} /> : riderRecording ? <AudioLines size={34} /> : <Mic size={34} />}
              <strong>{supportSpeaking ? "Support is speaking" : riderRecording ? interactionMode === "hold" ? "Release to send" : "Tap to send" : voipBusy ? "Translating…" : voip.connected && !voip.peerConnected ? "Waiting for support" : interactionMode === "hold" ? "Hold to speak" : "Tap to speak"}</strong>
              <small>{supportSpeaking ? "Playing in Hindi" : voip.phase === "requesting-permission" ? "Opening microphone…" : riderRecording ? "Listening in Hindi" : "Speak Hindi"}</small>
            </button>
            <div className={styles.modeToggle}>
              <span>{interactionMode === "hold" ? "Press-and-hold mode" : "Tap mode"}</span>
              <button
                type="button"
                disabled={
                  voipBusy ||
                  riderRecording ||
                  supportSpeaking ||
                  voip.phase === "requesting-permission"
                }
                onClick={() =>
                  setInteractionMode((current) =>
                    current === "hold" ? "tap" : "hold",
                  )
                }
              >
                {interactionMode === "hold" ? "Use tap instead" : "Use press and hold"}
              </button>
            </div>
            {voip.errorMessage && <div className={styles.hint} role="alert">{voip.errorMessage}</div>}
            <button className={styles.riderEnd} onClick={endCall}><PhoneOff size={15} /> End call</button>
            <div className={styles.hint}><Headphones size={14} /> One person speaks at a time</div>
          </>
        )}
      </section>
    </div>
  );
}
