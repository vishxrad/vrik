"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import type { ConversationAgent } from "sarvam-conv-ai-sdk/browser";

import { VOICE_AGENT_CONFIG } from "@/lib/voice-agent-config";

type CallState =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "ended"
  | "error";

type TranscriptLine = {
  id: number;
  role: "Ram" | "Support";
  text: string;
};

type SupportAgentCallProps = {
  open: boolean;
  onClose: () => void;
};

const STATUS_COPY: Record<CallState, string> = {
  idle: "Ready when you are",
  connecting: "Connecting to Hindi support…",
  connected: "Call connected",
  listening: "Listening to you",
  speaking: "Support is speaking",
  ended: "Call ended",
  error: "Couldn’t connect",
};

function friendlyError(error: unknown) {
  if (!navigator.onLine) {
    return "You’re offline. Reconnect to the internet and try again.";
  }

  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access is needed. Allow it in your browser and try again.";
  }

  const message = error instanceof Error ? error.message : "";
  if (/429|rate limit/i.test(message)) {
    return "Support is busy right now. Wait a moment and try again.";
  }
  if (/timeout|timed out/i.test(message)) {
    return "The call took too long to connect. Check your network and try again.";
  }
  if (/503|502|server error/i.test(message)) {
    return "Voice support is temporarily unavailable. Try again shortly.";
  }

  return "The support call could not start. Check microphone access and try again.";
}

export function SupportAgentCall({ open, onClose }: SupportAgentCallProps) {
  const agentRef = useRef<ConversationAgent | null>(null);
  const callAttemptRef = useRef(0);
  const transcriptIdRef = useRef(0);
  const [callState, setCallState] = useState<CallState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  const stopCall = useCallback(async (nextState: CallState = "ended") => {
    callAttemptRef.current += 1;
    const activeAgent = agentRef.current;
    agentRef.current = null;
    setMuted(false);

    if (activeAgent) {
      try {
        await activeAgent.stop();
      } catch {
        // The session may already have closed remotely.
      }
    }

    setCallState(nextState);
  }, []);

  const closeCall = useCallback(async () => {
    await stopCall("idle");
    setErrorMessage("");
    setTranscript([]);
    onClose();
  }, [onClose, stopCall]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeCall();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCall, open]);

  useEffect(() => {
    return () => {
      const activeAgent = agentRef.current;
      agentRef.current = null;
      if (activeAgent) void activeAgent.stop().catch(() => undefined);
    };
  }, []);

  const startCall = async () => {
    if (callState === "connecting" || agentRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCallState("error");
      setErrorMessage("This browser cannot use the microphone for support calls.");
      return;
    }

    const attempt = callAttemptRef.current + 1;
    callAttemptRef.current = attempt;
    setCallState("connecting");
    setErrorMessage("");
    setMuted(false);
    setTranscript([]);

    try {
      const {
        AgentState,
        BrowserAudioInterface,
        ConversationAgent,
        InteractionType,
      } = await import("sarvam-conv-ai-sdk/browser");
      if (callAttemptRef.current !== attempt) return;

      const audioInterface = new BrowserAudioInterface(16_000, {
        prebufferMs: 500,
      });
      const agent = new ConversationAgent({
        apiKey: "server-proxied",
        baseUrl: "/api/voice-agent/",
        platform: "browser",
        config: {
          user_identifier_type: "custom",
          user_identifier: `rider-${VOICE_AGENT_CONFIG.rider.id}`,
          org_id: VOICE_AGENT_CONFIG.orgId,
          workspace_id: VOICE_AGENT_CONFIG.workspaceId,
          app_id: VOICE_AGENT_CONFIG.appId,
          version: VOICE_AGENT_CONFIG.version,
          interaction_type: InteractionType.CALL,
          input_sample_rate: 16_000,
          output_sample_rate: 16_000,
          agent_variables: {
            user_name: VOICE_AGENT_CONFIG.rider.name,
            rider_id: VOICE_AGENT_CONFIG.rider.id,
            order_id: VOICE_AGENT_CONFIG.rider.orderId,
          },
        },
        audioInterface,
        stateCallback: (newState) => {
          if (callAttemptRef.current !== attempt) return;
          if (newState === AgentState.CONNECTING) setCallState("connecting");
          if (newState === AgentState.CONNECTED) setCallState("connected");
          if (newState === AgentState.LISTENING) setCallState("listening");
          if (newState === AgentState.SPEAKING) setCallState("speaking");
          if (newState === AgentState.ERROR) setCallState("error");
        },
        transcriptCallback: async (message) => {
          if (callAttemptRef.current !== attempt || !message.content.trim()) return;
          transcriptIdRef.current += 1;
          setTranscript((lines) => [
            ...lines.slice(-3),
            {
              id: transcriptIdRef.current,
              role: message.role === "user" ? "Ram" : "Support",
              text: message.content.trim(),
            },
          ]);
        },
        endCallback: async () => {
          if (callAttemptRef.current !== attempt) return;
          agentRef.current = null;
          setMuted(false);
          setCallState("ended");
        },
      });

      agentRef.current = agent;
      await agent.start();
      const connected = await agent.waitForConnect(12);
      if (!connected) throw new Error("Support call connection timed out");
    } catch (error) {
      if (callAttemptRef.current !== attempt) return;
      const activeAgent = agentRef.current;
      agentRef.current = null;
      if (activeAgent) await activeAgent.stop().catch(() => undefined);
      setCallState("error");
      setErrorMessage(friendlyError(error));
    }
  };

  const toggleMute = () => {
    const agent = agentRef.current;
    if (!agent) return;

    if (muted) {
      agent.unmute();
      setMuted(false);
    } else {
      agent.mute();
      setMuted(true);
    }
  };

  if (!open) return null;

  const active = ["connecting", "connected", "listening", "speaking"].includes(
    callState,
  );

  return (
    <div className="support-call-overlay" role="presentation">
      <section
        className="support-call-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-call-title"
      >
        <div className="support-call-handle" aria-hidden="true" />
        <header className="support-call-header">
          <span className="support-call-agent-icon"><Headphones size={22} /></span>
          <div>
            <span className="support-call-eyebrow">Zomato rider support</span>
            <h2 id="support-call-title">Talk to Hindi support</h2>
            <p>AI resolves common issues. A human calls back when needed.</p>
          </div>
          <button onClick={() => void closeCall()} aria-label="Close support call">
            <X size={19} />
          </button>
        </header>

        <div className={`support-call-orb ${callState}`} aria-hidden="true">
          {callState === "connecting" ? (
            <LoaderCircle className="support-call-spinner" size={38} />
          ) : callState === "speaking" ? (
            <Volume2 size={40} />
          ) : callState === "listening" ? (
            <Mic size={40} />
          ) : (
            <Bot size={38} />
          )}
          {active && <span />}
        </div>

        <div className="support-call-status" role="status" aria-live="polite">
          <strong>{STATUS_COPY[callState]}</strong>
          {active && <small>Order #{VOICE_AGENT_CONFIG.rider.orderId} · Ram</small>}
        </div>

        {transcript.length > 0 && (
          <div className="support-call-transcript" aria-label="Live call transcript">
            {transcript.map((line) => (
              <p key={line.id} className={line.role === "Ram" ? "rider" : "agent"}>
                <small>{line.role}</small>
                <span>{line.text}</span>
              </p>
            ))}
          </div>
        )}

        {errorMessage && (
          <div className="support-call-error" role="alert">
            {errorMessage}
          </div>
        )}

        {!active && (
          <button className="support-call-start" onClick={() => void startCall()}>
            <Phone size={20} />
            <span>{callState === "idle" ? "Start support call" : "Call again"}</span>
          </button>
        )}

        {active && (
          <div className="support-call-controls">
            <button onClick={toggleMute} disabled={callState === "connecting"}>
              <span>{muted ? <MicOff size={22} /> : <Mic size={22} />}</span>
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="end" onClick={() => void stopCall()}>
              <span><PhoneOff size={22} /></span>
              End call
            </button>
          </div>
        )}

        <div className="support-call-safety">
          <ShieldCheck size={16} />
          <span>For an accident or immediate danger, use Safety centre SOS.</span>
        </div>
      </section>
    </div>
  );
}
