"use client";

import { useEffect, useState } from "react";
import { ITEMS, type Engine, type GameView } from "@/lib/wasm/engine";
import type { ActionBody, PublicRoom } from "@/lib/types";
import { Modal } from "./Modal";

interface Props {
  engine: Engine;
  view: GameView;
  room: PublicRoom;
  meIndex: number;
  busy: boolean;
  act: (a: ActionBody) => void;
  serverNow: () => number;
}

/**
 * Two stages. 1) everyone except the target votes on which item comes off (only
 * items that can legally come off next are offered). 2) the target confirms it's
 * off, on camera.
 */
export function StripModal({ engine, view, room, meIndex, busy, act, serverNow }: Props) {
  const target = view.stripTarget;
  const targetName = room.players[target].name;
  const isTarget = meIndex === target;
  const me = view.players[meIndex];
  const state = room.state!;
  const voting = view.voteItem < 0;

  const legal = ITEMS.filter((it) => engine.canRemove(state, target, it.id));
  const tally = (id: number) => view.players.filter((p) => p.index !== target && p.alive && p.vote === id + 1).length;
  const voters = view.players.filter((p) => p.index !== target && p.alive);
  const voted = voters.filter((p) => p.vote > 0).length;

  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, [serverNow]);
  const secondsLeft = room.voteDeadline ? Math.max(0, Math.ceil((room.voteDeadline - now) / 1000)) : null;

  const reason =
    view.stripper >= 0 ? `${room.players[view.stripper].name} paid the tailor to make ${isTarget ? "you" : targetName} strip.` : `${isTarget ? "You" : targetName} came last in the minigame.`;

  if (!voting) {
    const item = ITEMS[view.voteItem];
    const lastItem = view.players[target].total === 1;
    return (
      <Modal title={isTarget ? "The vote is in" : `${targetName} is up`} tone="alert">
        <p className="text-white/75">{reason}</p>
        <p className="mt-4 rounded-2xl bg-glow-pink/10 p-4 text-center font-display text-2xl font-black">
          {isTarget ? "Take off your" : `${targetName} takes off their`} {item.name.toLowerCase()}
        </p>
        {isTarget ? (
          <>
            {lastItem && <p className="mt-3 rounded-lg bg-red-500/10 p-2.5 text-sm text-red-200">That's your last item. Removing it eliminates you.</p>}
            <button className="btn-primary mt-5 w-full" disabled={busy} onClick={() => act({ type: "strip", item: view.voteItem })}>
              It's off (confirm)
            </button>
            <p className="mt-3 text-center text-xs text-white/45">Not feeling it? Use "Tap out" at the top of the page. No explanation needed.</p>
          </>
        ) : (
          <p className="mt-4 text-center text-sm text-white/55">Waiting for {targetName} to confirm...</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={isTarget ? "Your friends are voting" : `Vote: what does ${targetName} take off?`} tone="alert">
      <p className="text-white/75">
        {reason} {isTarget ? "They'll pick what comes off next." : "Only items that can come off next are shown (shoes before socks, underwear last)."}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {legal.map((it) => {
          const mine = me.vote === it.id + 1;
          const n = tally(it.id);
          return (
            <button
              key={it.id}
              aria-pressed={mine}
              disabled={isTarget || busy}
              onClick={() => act({ type: "vote", item: it.id })}
              className={`btn justify-between border ${mine ? "border-glow-pink bg-glow-pink/15" : "border-white/15 bg-white/5 hover:bg-white/10"} disabled:opacity-100`}
            >
              <span>{it.name}</span>
              <span className="rounded-full bg-black/30 px-2 text-xs font-black text-glow-amber">{n}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-white/50">
        {voted}/{voters.length} voted{secondsLeft !== null ? ` · ${secondsLeft}s left` : ""}
        {!isTarget && me.vote > 0 ? " · you can change your vote" : ""}
      </p>
    </Modal>
  );
}
