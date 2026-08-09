"use client";

import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type PressToTalkMode = "hold" | "tap";

type PressToTalkOptions = {
  mode: PressToTalkMode;
  disabled: boolean;
  recording: boolean;
  start: () => void | Promise<void>;
  stop: () => void;
};

function hapticFeedback(pattern: number | number[]) {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

export function usePressToTalk({
  mode,
  disabled,
  recording,
  start,
  stop,
}: PressToTalkOptions) {
  const pressActiveRef = useRef(false);

  const begin = useCallback(() => {
    if (disabled || pressActiveRef.current) return;
    pressActiveRef.current = true;
    hapticFeedback(12);
    const started = start();
    if (mode === "tap") {
      void Promise.resolve(started).finally(() => {
        pressActiveRef.current = false;
      });
    }
  }, [disabled, mode, start]);

  const finish = useCallback(() => {
    if (!pressActiveRef.current && !recording) return;
    pressActiveRef.current = false;
    hapticFeedback(8);
    stop();
  }, [recording, stop]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (mode !== "hold" || disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      begin();
    },
    [begin, disabled, mode],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (mode !== "hold") return;
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finish();
    },
    [finish, mode],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        mode !== "hold" ||
        disabled ||
        event.repeat ||
        (event.key !== " " && event.key !== "Enter")
      ) {
        return;
      }
      event.preventDefault();
      begin();
    },
    [begin, disabled, mode],
  );

  const onKeyUp = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (mode !== "hold" || (event.key !== " " && event.key !== "Enter")) {
        return;
      }
      event.preventDefault();
      finish();
    },
    [finish, mode],
  );

  const onClick = useCallback(() => {
    if (mode !== "tap" || disabled) return;
    if (recording) {
      pressActiveRef.current = false;
      hapticFeedback([8, 24, 8]);
      stop();
      return;
    }
    begin();
  }, [begin, disabled, mode, recording, stop]);

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
    onKeyUp,
    onClick,
  };
}
