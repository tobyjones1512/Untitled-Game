"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MINIGAMES, type Engine, type GameView } from "@/lib/wasm/engine";
import { Modal } from "./Modal";

const COUNTDOWN_MS = 3000;
const MASH_MS = 5000;
const CLOCK_VISIBLE_MS = 2000;
const CLOCK_MAX_MS = 12000;

interface Props {
  engine: Engine;
  view: GameView;
  meIndex: number;
  startedAt: number;
  serverNow: () => number;
  onSubmit: (raw: number) => void;
}

/** Free-for-all minigame. Scoring and ranking happen in Wasm on the server; this only collects the raw result. */
export function MiniGame({ engine, view, meIndex, startedAt, serverNow, onSubmit }: Props) {
  const game = MINIGAMES[view.mgType];
  const playFrom = startedAt + COUNTDOWN_MS;
  const me = view.players[meIndex];
  const waiting = view.players.filter((p) => p.alive && !p.mgDone).length;

  const [now, setNow] = useState(serverNow());
  const [taps, setTaps] = useState(0);
  const sent = useRef(false);
  const tapsRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 40);
    return () => clearInterval(t);
  }, [serverNow]);

  const submit = useCallback(
    (raw: number) => {
      if (sent.current) return;
      sent.current = true;
      onSubmit(raw);
    },
    [onSubmit],
  );

  const sinceStart = now - playFrom; // ms since GO
  const counting = sinceStart < 0;
  const done = me.mgDone || sent.current;

  const tap = useCallback(() => {
    if (sent.current || serverNow() < playFrom) return;
    if (serverNow() > playFrom + MASH_MS) return;
    tapsRef.current += 1;
    setTaps(tapsRef.current);
  }, [playFrom, serverNow]);

  const stop = useCallback(() => {
    if (sent.current) return;
    const elapsed = serverNow() - playFrom;
    if (elapsed < 0) return;
    submit(Math.round(elapsed));
  }, [playFrom, serverNow, submit]);

  // auto-submit when the window closes
  useEffect(() => {
    if (sent.current || me.mgDone) return;
    if (view.mgType === 0 && sinceStart >= MASH_MS) submit(tapsRef.current);
    if (view.mgType === 1 && sinceStart >= CLOCK_MAX_MS) submit(-1);
  }, [sinceStart, view.mgType, me.mgDone, submit]);

  // spacebar support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      if (view.mgType === 0) tap();
      else stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.mgType, tap, stop]);

  const target = engine.mgTarget(view.mgSeed);
  const clock = Math.max(0, sinceStart);
  const clockHidden = clock > CLOCK_VISIBLE_MS;

  return (
    <Modal title={`Round ${view.round}: ${game.name}`}>
      <p className="text-sm text-white/65">{game.blurb} Last place takes something off.</p>

      <div className="mt-5 flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl bg-black/30 p-5 text-center">
        {counting ? (
          <>
            <p className="text-sm font-bold uppercase tracking-widest text-white/50">Get ready</p>
            <p key={Math.ceil(-sinceStart / 1000)} className="animate-pop font-display text-8xl font-black text-glow-amber">
              {Math.ceil(-sinceStart / 1000)}
            </p>
            {view.mgType === 1 && <p className="text-sm text-white/60">Target: <b className="text-white">{(target / 1000).toFixed(2)}s</b></p>}
          </>
        ) : view.mgType === 0 ? (
          <>
            <p className="font-display text-6xl font-black tabular-nums">{taps}</p>
            <p className="text-sm text-white/55">
              {done ? "Time! Waiting for others..." : `${Math.max(0, (MASH_MS - sinceStart) / 1000).toFixed(1)}s left`}
            </p>
            <button className="btn-primary h-24 w-full max-w-xs select-none text-2xl" disabled={done} onPointerDown={tap}>
              TAP!
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-white/60">Stop at <b className="text-white">{(target / 1000).toFixed(2)}s</b></p>
            <p className="font-display text-6xl font-black tabular-nums">{clockHidden ? "?.??" : (clock / 1000).toFixed(2)}</p>
            <button className="btn-primary h-24 w-full max-w-xs select-none text-2xl" disabled={done} onPointerDown={stop}>
              STOP
            </button>
            {done && <p className="text-sm text-white/55">Locked in. Waiting for others...</p>}
          </>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-white/45">
        {waiting} player{waiting === 1 ? "" : "s"} still playing · space bar works too
      </p>
    </Modal>
  );
}
