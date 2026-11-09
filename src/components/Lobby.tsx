"use client";

import { useState } from "react";
import type { PublicRoom } from "@/lib/types";
import { PLAYER_COLORS } from "@/lib/ui";

export function Lobby({ room, meId, busy, onStart, onLeave }: { room: PublicRoom; meId: string; busy: boolean; onStart: () => void; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === meId;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/room/${room.code}`;

  return (
    <div className="space-y-4">
      <div className="card p-5 text-center sm:p-7">
        <p className="label">Room code</p>
        <p className="font-mono text-6xl font-black tracking-[0.3em] text-glow-amber sm:text-7xl" aria-label={`Room code ${room.code.split("").join(" ")}`}>
          {room.code}
        </p>
        <button
          className="btn-ghost mt-4"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              window.prompt("Copy this link", link);
            }
          }}
        >
          {copied ? "✓ Link copied" : "Copy invite link"}
        </button>
      </div>

      <div className="card p-5">
        <h2 className="label">Players · {room.players.length}/4</h2>
        <ul className="space-y-2">
          {room.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
              <span className="h-3 w-3 rounded-full" style={{ background: PLAYER_COLORS[p.index] }} />
              <span className="font-bold">{p.name}</span>
              {p.id === room.hostId && <span className="rounded-full bg-glow-pink/20 px-2 py-0.5 text-[11px] font-bold text-glow-pink">HOST</span>}
              <span className="ml-auto text-xs text-white/50">{p.gender === "woman" ? "7 items · bra + 1 sock" : "7 items · 2 socks"}</span>
            </li>
          ))}
          {Array.from({ length: Math.max(0, 2 - room.players.length) }, (_, i) => (
            <li key={`e${i}`} className="rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-sm text-white/40">
              Waiting for a player to join...
            </li>
          ))}
        </ul>

        <div className="mt-5 flex gap-2">
          {isHost ? (
            <button className="btn-primary flex-1 py-3 text-base" disabled={busy || room.players.length < 2} onClick={onStart}>
              {room.players.length < 2 ? "Need 2+ players" : "Start game"}
            </button>
          ) : (
            <p className="flex-1 rounded-xl bg-white/5 px-3 py-3 text-center text-sm text-white/60">Waiting for the host to start...</p>
          )}
          <button className="btn-ghost" disabled={busy} onClick={onLeave}>
            Leave
          </button>
        </div>
        <p className="mt-3 text-xs text-white/45">Allow your camera when asked. Everyone should be able to see each other before the host starts.</p>
      </div>
    </div>
  );
}
