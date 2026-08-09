"use client";

import {
  CALLBACK_DEMO_CHANNEL,
  type CallbackDemoEvent,
} from "@/lib/callback-demo";

export function openCallbackDemoChannel(
  onMessage: (event: CallbackDemoEvent) => void,
) {
  if (typeof BroadcastChannel === "undefined") return null;

  const channel = new BroadcastChannel(CALLBACK_DEMO_CHANNEL);
  channel.addEventListener("message", (message: MessageEvent<CallbackDemoEvent>) => {
    if (message.data && typeof message.data.type === "string") {
      onMessage(message.data);
    }
  });
  return channel;
}

export function publishCallbackDemoEvent(event: CallbackDemoEvent) {
  if (typeof BroadcastChannel === "undefined") return false;
  const channel = new BroadcastChannel(CALLBACK_DEMO_CHANNEL);
  channel.postMessage(event);
  channel.close();
  return true;
}

