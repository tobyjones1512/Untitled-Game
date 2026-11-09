"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cancelQueue, getMatchStatus } from "@/lib/client/api";
import { saveCreds } from "@/lib/client/session";

/** Polls the matchmaking queue every 2s until a room is formed. */
export function MatchSearch({ ticket, onCancel }: { ticket: string; onCancel: () => void }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(1);
  const [secs, setSecs] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const t0 = Date.now();
    const clock = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    const poll = setInterval(async () => {
      if (done.current) return;
      const s = await getMatchStatus(ticket);
      if (s.state === "matched") {
        done.current = true;
        saveCreds(s.code, { playerId: s.playerId, token: s.token });
        router.push(`/room/${s.code}`);
      } else if (s.state === "waiting") setWaiting(s.waiting);
      else if (s.state === "gone") {
        done.current = true;
        onCancel();
      }
    }, 2000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [ticket, router, onCancel]);

  return (
    <div className="space-y-4 py-4 text-center" aria-live="polite">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-glow-pink" />
      <p className="font-display text-xl font-black">Finding players...</p>
      <p className="text-sm text-white/60">
        {waiting} searching · {secs}s. A room forms as soon as 2+ adults are ready (up to 4).
      </p>
      <button
        className="btn-ghost"
        onClick={async () => {
          done.current = true;
          await cancelQueue(ticket).catch(() => undefined);
          onCancel();
        }}
      >
        Cancel
      </button>
    </div>
  );
}
