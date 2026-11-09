"use client";

import { useState } from "react";
import { ITEMS, type GameView } from "@/lib/wasm/engine";
import type { ActionBody, PublicRoom } from "@/lib/types";
import { Modal } from "./Modal";

export function StripModal({ view, room, meIndex, busy, act }: { view: GameView; room: PublicRoom; meIndex: number; busy: boolean; act: (a: ActionBody) => void }) {
  const me = view.players[meIndex];
  const [picked, setPicked] = useState<number | null>(null);
  const reason =
    view.stripper >= 0 ? `${room.players[view.stripper].name} paid the tailor to make you strip.` : "You came last in the minigame.";
  const lastItem = me.total === 1;

  return (
    <Modal title="Time to lose a layer" tone="alert">
      <p className="text-white/75">{reason} Choose one item and take it off on camera.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {ITEMS.filter((it) => me.items[it.id] > 0).map((it) => (
          <button
            key={it.id}
            aria-pressed={picked === it.id}
            className={`btn justify-start border ${picked === it.id ? "border-glow-pink bg-glow-pink/15" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
            onClick={() => setPicked(it.id)}
          >
            <span className="text-xl">{it.icon}</span>
            <span>{it.name}</span>
            {me.items[it.id] > 1 && <span className="ml-auto text-xs text-white/50">×{me.items[it.id]}</span>}
          </button>
        ))}
      </div>
      {lastItem && <p className="mt-3 rounded-lg bg-red-500/10 p-2.5 text-sm text-red-200">That's your last item. Removing it eliminates you.</p>}
      <div className="mt-5 flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || picked === null} onClick={() => picked !== null && act({ type: "strip", item: picked })}>
          {picked === null ? "Pick an item" : "It's off (confirm)"}
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-white/45">Not feeling it? Use "Tap out" at the top of the page. No explanation needed.</p>
    </Modal>
  );
}
