"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `tick` immediately, then every `intervalMs` while the tab is visible. Hidden tabs (a
 * locked phone, another app) stop polling entirely and poll once immediately
 * when they come back.
 */
export function usePolling(tick: () => Promise<void>, intervalMs = 2500) {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const run = async () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      try {
        await tickRef.current();
      } finally {
        if (!stopped && document.visibilityState === "visible") timer = setTimeout(run, intervalMs);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
      else clearTimeout(timer);
    };

    timer = setTimeout(run, 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
