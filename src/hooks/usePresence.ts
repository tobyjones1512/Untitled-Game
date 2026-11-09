"use client";

import { useEffect, useState } from "react";

const BEAT_MS = 45_000;

/**
 * Sends a heartbeat while the page is visible and returns how many people are online
 * (null until the first answer). Pass `count: false` to beat without showing a number.
 */
export function usePresence(): number | null {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    let stopped = false;
    const beat = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok && !stopped) setOnline(((await res.json()) as { online: number }).online);
      } catch {
        /* offline: keep the last number */
      }
    };
    beat();
    const t = setInterval(beat, BEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return online;
}
