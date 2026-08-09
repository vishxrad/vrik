"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ArrowRight,
  CircleAlert,
  Headphones,
  Languages,
  Mic,
  Phone,
  PhoneOff,
  Radio,
  ShieldCheck,
  Volume2,
} from "lucide-react";

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

type ConsoleState = "ready" | "ringing" | "connected" | "recording" | "ended";

export function SupportCallbackConsole() {
  const [state, setState] = useState<ConsoleState>("ready");
  const [notice, setNotice] = useState("Ready to call Ram in the partner app");
  const [callback, setCallback] = useState<CallbackApiRecord | null>(null);
  const [databaseReady, setDatabaseReady] = useState<boolean | null>(null);
  const [interactionMode, setInteractionMode] =
    useState<PressToTalkMode>("hold");
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackRecordingRef = useRef(false);
  const voip = useTranslatedVoipCall("support");

  const syncCallback = useCallback(async () => {
    try {
      const response = await fetch("/api/support/callbacks", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 503) setDatabaseReady(false);
        return;
      }
      const body = (await response.json()) as { callback: CallbackApiRecord | null };
      setDatabaseReady(true);
      setCallback(body.callback);
      if (body.callback?.status === "ringing") {
        setState("ringing");
        setNotice("Ringing Ram’s partner app…");
      }
      if (body.callback?.status === "connected") {
        setState("connected");
        setNotice("Connected · Ram hears the Hindi translation");
      }
    } catch {
      setDatabaseReady(false);
    }
  }, []);

  useEffect(() => {
    const channel = openCallbackDemoChannel((event: CallbackDemoEvent) => {
      if (event.type === "accept") {
        setState("connected");
        setNotice("Connected · Ram hears the Hindi translation");
      }
      if (event.type === "decline") {
        setState("ready");
        setNotice("Ram declined the callback");
      }
      if (event.type === "end") {
        setState("ended");
        setNotice("Callback ended");
      }
    });
    return () => channel?.close();
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void syncCallback(), 0);
    const interval = window.setInterval(() => void syncCallback(), 2_500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [syncCallback]);

  useEffect(() => () => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
  }, []);

  async function callRam() {
    setState("ringing");
    setNotice("Ringing Ram’s partner app…");
    let nextCallback = callback;

    if (databaseReady !== false) {
      try {
        if (!nextCallback || !["requested", "ringing", "connected"].includes(nextCallback.status)) {
          const created = await fetch("/api/support/callbacks/demo", { method: "POST" });
          if (!created.ok) throw new Error("create failed");
          nextCallback = ((await created.json()) as { callback: CallbackApiRecord }).callback;
        }

        if (nextCallback.status === "requested") {
          const ringing = await fetch(`/api/support/callbacks/${nextCallback.id}/ring`, {
            method: "POST",
          });
          if (!ringing.ok) throw new Error("ring failed");
          nextCallback = ((await ringing.json()) as { callback: CallbackApiRecord }).callback;
        }
        setDatabaseReady(true);
        setCallback(nextCallback);
        const connected = await voip.connect(nextCallback.id);
        if (!connected) {
          setNotice("Ringing in preview mode · add LiveKit credentials for cross-device VoIP");
        }
      } catch {
        setDatabaseReady(false);
        setNotice("Database unavailable · using the same-browser preview");
      }
    }

    const delivered = publishCallbackDemoEvent({
      type: "ring",
      at: Date.now(),
      callbackId: nextCallback?.id,
    });
    if (!delivered) {
      setNotice("Open this page and the rider app in a browser that supports tab messaging.");
    }
  }

  function finishFallbackTurn() {
    if (!fallbackRecordingRef.current) return;
    fallbackRecordingRef.current = false;
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    setState("connected");
    setNotice("Hindi audio delivered to Ram");
    publishCallbackDemoEvent({ type: "turn-end", speaker: "support", at: Date.now() });
  }

  function startSupportTurn() {
    if (state !== "connected") return;
    if (voip.connected) {
      void voip.startRecording();
      return;
    }
    fallbackRecordingRef.current = true;
    setState("recording");
    setNotice("Listening in English…");
    publishCallbackDemoEvent({ type: "turn-start", speaker: "support", at: Date.now() });
    recordingTimer.current = setTimeout(finishFallbackTurn, 15_000);
  }

  function stopSupportTurn() {
    if (voip.connected) {
      voip.stopRecording();
      return;
    }
    finishFallbackTurn();
  }

  async function endCall() {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    if (callback) {
      await fetch(`/api/support/callbacks/${callback.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: state === "ringing" ? "cancelled" : "completed" }),
      }).catch(() => undefined);
    }
    setState("ended");
    setNotice("Callback ended");
    setCallback(null);
    await voip.disconnect();
    publishCallbackDemoEvent({ type: "end", at: Date.now(), callbackId: callback?.id });
  }

  const active = state === "connected" || state === "recording";
  const voipBusy = [
    "transcribing",
    "translating",
    "synthesizing",
    "sending",
    "receiving",
  ].includes(voip.phase);
  const shownTurn = voip.lastTurn;
  const supportRecording = voip.phase === "recording" || state === "recording";
  const talkDisabled = voipBusy || (voip.connected && !voip.peerConnected);
  const pressToTalk = usePressToTalk({
    mode: interactionMode,
    disabled: talkDisabled,
    recording: supportRecording,
    start: startSupportTurn,
    stop: stopSupportTurn,
  });

  return (
    <main className={styles.operatorPage}>
      <header className={styles.operatorHeader}>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Headphones size={20} /></span>
          <div><strong>Zomato Partner Support</strong><small>Translated callback console</small></div>
        </div>
        <span className={styles.agentStatus}>Support online</span>
      </header>

      <div className={styles.operatorMain}>
        <aside className={styles.sidebar} aria-label="Callback request">
          <div className={styles.queueHeader}>
            <div><h1>Callback requests</h1><p>AI-escalated rider issues</p></div>
            <span className={styles.queueCount}>1</span>
          </div>
          <article className={styles.requestCard}>
            <div className={styles.requestMeta}>
              <span>Waiting now</span>
              <span className={styles.priority}><CircleAlert size={12} /> {DEMO_CALLBACK.issue.priority}</span>
            </div>
            <div className={styles.riderRow}>
              <span className={styles.avatar}>{DEMO_CALLBACK.rider.initials}</span>
              <div><strong>{DEMO_CALLBACK.rider.name}</strong><small>{DEMO_CALLBACK.rider.phoneDisplay} · Hindi</small></div>
            </div>
            <p className={styles.issueTitle}>{DEMO_CALLBACK.issue.type}</p>
            <p className={styles.issueSummary}>{DEMO_CALLBACK.issue.summary}</p>
            <dl className={styles.orderFacts}>
              <div><dt>Order</dt><dd>#{DEMO_CALLBACK.order.id}</dd></div>
              <div><dt>Pickup</dt><dd>{DEMO_CALLBACK.order.restaurant}</dd></div>
              <div><dt>Drop</dt><dd>{DEMO_CALLBACK.order.destination}</dd></div>
            </dl>
          </article>
        </aside>

        <section className={styles.callPanel} aria-labelledby="callback-title">
          <header className={styles.callHeader}>
            <div className={styles.languageBridge}>
              <span>Support speaks English</span><ArrowRight size={14} /><span>Ram hears Hindi</span>
            </div>
            <span className={styles.demoBadge}>Foreground app demo</span>
          </header>

          <div className={styles.callBody}>
            <span className={`${styles.callAvatar} ${styles[state] ?? ""}`}>{DEMO_CALLBACK.rider.initials}</span>
            <h2 id="callback-title">{DEMO_CALLBACK.rider.name}</h2>
            <p>Call the fixed demo rider inside the partner app. Spoken turns are translated after each person releases the button.</p>

            <div className={`${styles.statusLine} ${active ? styles.connected : ""}`} role="status" aria-live="polite">
              {state === "ringing" ? <Radio size={15} /> : active ? <Volume2 size={15} /> : <ShieldCheck size={15} />}
              <span>
                {voip.errorMessage ||
                  (voip.connected && !voip.peerConnected
                    ? "VoIP ready · waiting for Ram to answer"
                    : voip.phase === "transcribing"
                      ? "Understanding your English…"
                      : voip.phase === "translating"
                        ? "Translating to Hindi…"
                        : voip.phase === "synthesizing"
                          ? "Creating Hindi speech…"
                          : voip.phase === "sending"
                            ? "Sending Hindi audio to Ram…"
                            : notice)}
                {databaseReady === true ? " · saved in Postgres" : ""}
              </span>
            </div>

            {(state === "ready" || state === "ended") && (
              <button className={styles.primaryAction} onClick={callRam}>
                <Phone size={18} /> Call Ram
              </button>
            )}

            {state === "ringing" && (
              <button className={styles.endAction} onClick={endCall}>
                <PhoneOff size={17} /> Cancel callback
              </button>
            )}

            {active && (
              <>
                <div className={styles.talkArea}>
                  <button
                    className={`${styles.talkButton} ${voip.phase === "recording" || state === "recording" ? styles.recording : ""}`}
                    {...pressToTalk}
                    disabled={talkDisabled}
                    aria-pressed={supportRecording}
                  >
                    <span>{supportRecording ? <AudioLines size={31} /> : <Mic size={31} />}</span>
                    <strong>{supportRecording ? (interactionMode === "hold" ? "Release to send" : "Tap to send") : voipBusy ? "Working…" : interactionMode === "hold" ? "Hold to speak" : "Tap to speak"}</strong>
                    <small>{voip.phase === "requesting-permission" ? "Opening microphone…" : supportRecording ? "Listening in English" : "Speak English"}</small>
                  </button>
                </div>
                <div className={styles.modeToggle}>
                  <span>{interactionMode === "hold" ? "Press-and-hold mode" : "Tap mode"}</span>
                  <button
                    type="button"
                    disabled={
                      voipBusy ||
                      supportRecording ||
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
                <div className={styles.translationPreview} aria-label="Example translated turn">
                  <div><small>{shownTurn?.speaker === "rider" ? "Ram said · Hindi" : "You said · English"}</small><p>{shownTurn?.sourceText || "I can guide you to the customer entrance. Are you near Tower C?"}</p></div>
                  <div><small>{shownTurn?.speaker === "rider" ? "You hear · English" : "Ram hears · Hindi"}</small><p>{shownTurn?.translatedText || "मैं आपको ग्राहक के प्रवेश द्वार तक पहुँचा सकता हूँ। क्या आप टावर सी के पास हैं?"}</p></div>
                </div>
                <button className={styles.endAction} onClick={endCall}>
                  <PhoneOff size={17} /> End callback
                </button>
              </>
            )}

            <div className={styles.hint}><Languages size={14} /> English ↔ Hindi · translated one turn at a time</div>
          </div>
        </section>
      </div>
    </main>
  );
}
