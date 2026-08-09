"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Radio,
  ShieldCheck,
  Volume2,
} from "lucide-react";

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

type ConsoleState = "ready" | "ringing" | "connected" | "ended";

export function SupportCallbackConsole() {
  const [state, setState] = useState<ConsoleState>("ready");
  const [notice, setNotice] = useState("Ready to call Ram in the partner app");
  const [callback, setCallback] = useState<CallbackApiRecord | null>(null);
  const [databaseReady, setDatabaseReady] = useState<boolean | null>(null);
  const callbackIdRef = useRef("");
  const call = useLivekitAudioCall("support");
  const disconnectCall = call.disconnect;

  const syncCallback = useCallback(async () => {
    try {
      const response = await fetch("/api/support/callbacks", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 503) setDatabaseReady(false);
        return;
      }
      const body = (await response.json()) as { callback: CallbackApiRecord | null };
      setDatabaseReady(true);
      if (!body.callback) {
        const hadCallback = Boolean(callbackIdRef.current);
        callbackIdRef.current = "";
        setCallback(null);
        if (hadCallback) {
          setState("ended");
          setNotice("Callback ended");
          void disconnectCall();
        }
        return;
      }
      callbackIdRef.current = body.callback.id;
      setCallback(body.callback);
      if (body.callback?.status === "ringing") {
        setState("ringing");
        setNotice("Ringing Ram’s partner app…");
      }
      if (body.callback?.status === "connected") {
        setState("connected");
        setNotice("Ram answered the callback");
      }
    } catch {
      setDatabaseReady(false);
    }
  }, [disconnectCall]);

  useEffect(() => {
    const channel = openCallbackDemoChannel((event: CallbackDemoEvent) => {
      if (event.type === "accept") {
        setState("connected");
        setNotice("Ram answered the callback");
      }
      if (event.type === "decline") {
        setState("ready");
        setNotice("Ram declined the callback");
        callbackIdRef.current = "";
        setCallback(null);
        void disconnectCall();
      }
      if (event.type === "end") {
        setState("ended");
        setNotice("Callback ended");
        callbackIdRef.current = "";
        setCallback(null);
        void disconnectCall();
      }
    });
    return () => channel?.close();
  }, [disconnectCall]);

  useEffect(() => {
    const initial = window.setTimeout(() => void syncCallback(), 0);
    const interval = window.setInterval(() => void syncCallback(), 2_500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [syncCallback]);

  async function callRam() {
    setState("ringing");
    setNotice("Ringing Ram’s partner app…");
    let nextCallback = callback;

    try {
      if (!nextCallback || !["requested", "ringing", "connected"].includes(nextCallback.status)) {
        const created = await fetch("/api/support/callbacks/demo", { method: "POST" });
        if (!created.ok) throw new Error("The callback could not be created.");
        nextCallback = ((await created.json()) as { callback: CallbackApiRecord }).callback;
      }

      if (nextCallback.status === "requested") {
        const ringing = await fetch(`/api/support/callbacks/${nextCallback.id}/ring`, {
          method: "POST",
        });
        if (!ringing.ok) throw new Error("Ram’s app could not be rung.");
        nextCallback = ((await ringing.json()) as { callback: CallbackApiRecord }).callback;
      }

      setDatabaseReady(true);
      setCallback(nextCallback);
      callbackIdRef.current = nextCallback.id;
      const joined = await call.connect(nextCallback.id);
      if (!joined) setNotice("The audio room could not connect. Retry or cancel the callback.");

      publishCallbackDemoEvent({
        type: "ring",
        at: Date.now(),
        callbackId: nextCallback.id,
      });
    } catch (error) {
      setDatabaseReady(false);
      setState("ready");
      setNotice(error instanceof Error ? error.message : "The callback could not start.");
    }
  }

  async function reconnectAudio() {
    if (!callback) return;
    await call.connect(callback.id);
  }

  async function endCall() {
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
    callbackIdRef.current = "";
    await call.disconnect();
    publishCallbackDemoEvent({ type: "end", at: Date.now(), callbackId: callback?.id });
  }

  const active = state === "connected";
  const statusText =
    call.errorMessage ||
    (call.phase === "connecting"
      ? "Joining the LiveKit audio room…"
      : call.connected && !call.peerConnected
        ? "Audio ready · waiting for Ram to answer"
        : call.peerSpeaking
          ? "Ram is speaking"
          : call.connected && call.muted
            ? "Connected · your microphone is muted"
            : call.connected
              ? "Connected · your microphone is on"
              : notice);

  return (
    <main className={styles.operatorPage}>
      <header className={styles.operatorHeader}>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Headphones size={20} /></span>
          <div><strong>Zomato Partner Support</strong><small>Live callback console</small></div>
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
              <PhoneCall size={15} /><span>LiveKit audio room</span><span>Both people can speak</span>
            </div>
            <span className={styles.demoBadge}>Foreground app demo</span>
          </header>

          <div className={styles.callBody}>
            <span className={`${styles.callAvatar} ${styles[state] ?? ""}`}>{DEMO_CALLBACK.rider.initials}</span>
            <h2 id="callback-title">{DEMO_CALLBACK.rider.name}</h2>
            <p>A normal live audio call inside the partner app. There is no translation and no hold-to-speak step.</p>

            <div className={`${styles.statusLine} ${active ? styles.connected : ""}`} role="status" aria-live="polite">
              {state === "ringing" ? <Radio size={15} /> : call.peerSpeaking ? <Volume2 size={15} /> : <ShieldCheck size={15} />}
              <span>
                {statusText}
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

                {!call.connected && callback && (
                  <button className={styles.secondaryAction} onClick={reconnectAudio}>
                    Reconnect audio
                  </button>
                )}
                {call.audioPlaybackBlocked && (
                  <button className={styles.secondaryAction} onClick={() => void call.resumeAudio()}>
                    Enable speaker audio
                  </button>
                )}
              </>
            )}

            <div className={styles.hint}><PhoneCall size={14} /> Live browser audio · no translation or recording</div>
          </div>
        </section>
      </div>
    </main>
  );
}
