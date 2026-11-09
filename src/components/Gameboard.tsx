"use client";

import { useEffect, useRef, useState } from "react";
import { MINIGAMES, Phase, type Engine, type GameView } from "@/lib/wasm/engine";
import type { ActionBody, PublicRoom } from "@/lib/types";
import { PLAYER_COLORS, SPACE_STYLE, boardCell } from "@/lib/ui";
import { Dice } from "./Dice";
import { InventoryBadges } from "./InventoryBadges";

interface Props {
  engine: Engine;
  room: PublicRoom;
  view: GameView;
  meIndex: number;
  busy: boolean;
  act: (a: ActionBody) => void;
}

export function Gameboard({ engine, room, view, meIndex, busy, act }: Props) {
  const size = engine.boardSize;
  const name = (i: number) => room.players[i]?.name ?? "?";
  const lastRoll = [...room.log].reverse().find((l) => l.kind === "roll");
  const rollId = lastRoll?.id ?? 0;

  // hold tokens in place until the dice settle so the roll isn't spoiled
  const positions = view.players.map((p) => p.pos).join(",");
  const [shownPositions, setShownPositions] = useState(positions);
  const seenRoll = useRef(rollId);
  useEffect(() => {
    if (rollId !== seenRoll.current) {
      seenRoll.current = rollId;
      const t = setTimeout(() => setShownPositions(positions), 950);
      return () => clearTimeout(t);
    }
    setShownPositions(positions);
  }, [positions, rollId]);
  const shown = shownPositions.split(",").map(Number);

  const myTurn = view.cur === meIndex && view.players[meIndex].alive;
  const spaceTokens: Record<number, number[]> = {};
  view.players.forEach((p) => {
    if (!p.alive) return;
    (spaceTokens[shown[p.index] ?? 0] ??= []).push(p.index);
  });

  return (
    <div className="space-y-4">
      <div className="card mx-auto w-full p-2.5 sm:p-3" style={{ maxWidth: "min(100%, 640px, calc(100vh - 10rem))" }}>
        <div className="grid aspect-square w-full grid-cols-7 grid-rows-7 gap-1 sm:gap-1.5">
          {Array.from({ length: size }, (_, i) => {
            const { row, col } = boardCell(i);
            const style = SPACE_STYLE[engine.spaceType(i)];
            return (
              <div
                key={i}
                title={style.title}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}
                className={`relative flex items-center justify-center rounded-lg border text-[10px] font-black sm:text-xs ${style.cls}`}
              >
                <span className="opacity-80">{style.label}</span>
                <div className="absolute inset-0 flex flex-wrap content-center items-center justify-center gap-0.5 p-0.5">
                  {(spaceTokens[i] ?? []).map((pi) => (
                    <span
                      key={pi}
                      title={name(pi)}
                      className="grid h-4 w-4 animate-pop place-items-center rounded-full border-2 border-white text-[9px] font-black text-ink-950 shadow sm:h-6 sm:w-6 sm:text-xs"
                      style={{ background: PLAYER_COLORS[pi] }}
                    >
                      {name(pi).slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/30 p-2 text-center" style={{ gridArea: "2 / 2 / 7 / 7" }}>
            <TurnPanel {...{ view, room, name, meIndex, myTurn, busy, act, rollId, engine }} />
            <Dice value={view.lastRoll} rollId={rollId} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {view.players.map((p) => (
          <div
            key={p.index}
            className={`card flex flex-col gap-1.5 p-2.5 ${!p.alive ? "opacity-50" : ""} ${view.cur === p.index && p.alive ? "ring-2" : ""}`}
            style={view.cur === p.index && p.alive ? ({ "--tw-ring-color": PLAYER_COLORS[p.index] } as React.CSSProperties) : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 font-bold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[p.index] }} />
                <span className="truncate">{name(p.index)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-glow-amber/15 px-2 py-0.5 text-sm font-black text-glow-amber" aria-label={`${p.coins} coins`}>
                🪙 {p.coins}
              </span>
            </div>
            <InventoryBadges engine={engine} player={p} />
            <span className="text-[11px] text-white/50">{p.alive ? `${p.total}/7 items` : "Eliminated"}</span>
          </div>
        ))}
      </div>

      <div className="card max-h-44 space-y-1 overflow-y-auto p-3 text-sm" aria-live="polite">
        <h3 className="label">Event feed</h3>
        {[...room.log].reverse().slice(0, 12).map((l) => (
          <p key={l.id} className="text-white/75">
            {l.msg}
          </p>
        ))}
      </div>
    </div>
  );
}

function TurnPanel({
  view,
  room,
  name,
  meIndex,
  myTurn,
  busy,
  act,
  engine,
}: {
  view: GameView;
  room: PublicRoom;
  name: (i: number) => string;
  meIndex: number;
  myTurn: boolean;
  busy: boolean;
  act: (a: ActionBody) => void;
  rollId: number;
  engine: Engine;
}) {
  const me = view.players[meIndex];
  let headline = "";
  let sub = "";
  switch (view.phase) {
    case Phase.ROLL:
      headline = myTurn ? "Your turn!" : `${name(view.cur)}'s turn`;
      sub = myTurn ? "" : "Waiting for them to roll...";
      break;
    case Phase.SHOP:
      headline = myTurn ? "Tailor Shop" : `${name(view.cur)} is at the tailor`;
      sub = myTurn ? "" : "They're deciding what to buy.";
      break;
    case Phase.MINI:
      headline = `${MINIGAMES[view.mgType].name}!`;
      sub = "Everyone's playing";
      break;
    case Phase.STRIP:
      headline = `${name(view.stripTarget)} strips`;
      sub = view.stripper >= 0 ? `${name(view.stripper)} paid the tailor.` : "Last place in the minigame.";
      break;
    case Phase.OVER:
      headline = view.winner >= 0 ? `${name(view.winner)} wins!` : "Draw!";
      break;
  }

  return (
    <>
      <p className="font-display text-base font-black leading-tight sm:text-xl">{headline}</p>
      {sub && <p className="text-[11px] text-white/60 sm:text-sm">{sub}</p>}
      {view.phase === Phase.ROLL && myTurn && me.alive && (
        <button className="btn-primary px-6 py-3 text-base" disabled={busy} onClick={() => act({ type: "roll" })}>
          🎲 Roll
        </button>
      )}
      {view.phase === Phase.STRIP && view.mgWinner >= 0 && view.stripper < 0 && (
        <ol className="w-full max-w-[14rem] space-y-0.5 text-left text-[11px] sm:text-xs">
          {[...view.players]
            .filter((p) => p.mgRank > 0)
            .sort((a, b) => a.mgRank - b.mgRank)
            .map((p) => (
              <li key={p.index} className="flex justify-between gap-2 rounded bg-white/5 px-2 py-0.5">
                <span className="truncate">
                  {p.mgRank}. {name(p.index)}
                </span>
                <span className="text-white/55">{view.mgType === 0 ? `${p.mgScore / 1000} taps` : p.mgScore > 0 ? `${(p.mgScore / 1000).toFixed(1)}pts` : "DNF"}</span>
              </li>
            ))}
        </ol>
      )}
      {view.phase === Phase.ROLL && !myTurn && <p className="text-[11px] text-white/40 sm:text-xs">{engine.blueCoins} coins on blue, -{engine.redCoins} on red</p>}
    </>
  );
}
