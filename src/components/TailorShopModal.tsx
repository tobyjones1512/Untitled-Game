"use client";

import { ITEMS, type Engine, type GameView } from "@/lib/wasm/engine";
import type { PublicRoom } from "@/lib/types";
import type { ActionBody } from "@/lib/types";
import { Modal } from "./Modal";

interface Props {
  engine: Engine;
  view: GameView;
  room: PublicRoom;
  meIndex: number;
  busy: boolean;
  act: (a: ActionBody) => void;
}

export function TailorShopModal({ engine, view, room, meIndex, busy, act }: Props) {
  const me = view.players[meIndex];
  const missing = ITEMS.filter((it) => me.items[it.id] < engine.startCount(it.id, me.gender));
  const canRestore = me.coins >= engine.costRestore;
  const canForce = me.coins >= engine.costForce;
  const targets = view.players.filter((p) => p.alive && p.index !== meIndex);

  return (
    <Modal title="✂️ The Tailor Shop">
      <p className="flex items-center gap-2 text-sm text-white/70">
        You have <b className="rounded-full bg-glow-amber/20 px-2.5 py-0.5 text-glow-amber">🪙 {me.coins}</b> coins. Spend as many times as you like, then leave.
      </p>

      <section className="mt-5">
        <h3 className="label">Put an item back on · {engine.costRestore} coins</h3>
        {missing.length === 0 ? (
          <p className="rounded-xl bg-white/5 p-3 text-sm text-white/55">You haven't lost anything yet. Nice.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {missing.map((it) => (
              <button key={it.id} className="btn-ghost justify-start" disabled={busy || !canRestore} onClick={() => act({ type: "buy", item: it.id })}>
                <span className="text-lg">{it.icon}</span> {it.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5">
        <h3 className="label">Make an opponent strip · {engine.costForce} coins</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {targets.map((p) => (
            <button key={p.index} className="btn-danger justify-between" disabled={busy || !canForce} onClick={() => act({ type: "force", target: p.index })}>
              <span>{room.players[p.index].name}</span>
              <span className="text-xs opacity-70">{p.total} items</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/45">They choose which item to remove, on camera.</p>
      </section>

      <button className="btn-primary mt-6 w-full" disabled={busy} onClick={() => act({ type: "leaveShop" })}>
        Leave shop
      </button>
    </Modal>
  );
}
