"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MINIGAMES, type Engine, type GameView } from "@/lib/wasm/engine";
import { Modal } from "./Modal";

const COUNTDOWN_MS = 3000;

interface Props {
  engine: Engine;
  view: GameView;
  meIndex: number;
  startedAt: number;
  serverNow: () => number;
  onSubmit: (raw: number) => void;
}

/** What every individual game gets: ms since "GO" (negative while counting down) and a one-shot submit. */
interface GameProps {
  engine: Engine;
  seed: number;
  elapsed: number;
  done: boolean;
  submit: (raw: number) => void;
}

/**
 * Free-for-all minigame shell. Scoring and ranking happen in Wasm on the server;
 * each game below only measures one raw number and submits it once.
 */
export function MiniGame({ engine, view, meIndex, startedAt, serverNow, onSubmit }: Props) {
  const game = MINIGAMES[view.mgType];
  const playFrom = startedAt + COUNTDOWN_MS;
  const me = view.players[meIndex];
  const waiting = view.players.filter((p) => p.alive && !p.mgDone).length;

  const [now, setNow] = useState(serverNow());
  const sent = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 16);
    return () => clearInterval(t);
  }, [serverNow]);

  const submit = useCallback(
    (raw: number) => {
      if (sent.current) return;
      sent.current = true;
      force((n) => n + 1);
      onSubmit(raw);
    },
    [onSubmit],
  );

  const elapsed = now - playFrom;
  const done = me.mgDone || sent.current;
  const props: GameProps = { engine, seed: view.mgSeed, elapsed, done, submit };

  return (
    <Modal title={`Round ${view.round}: ${game.name}`}>
      <p className="text-sm text-white/65">{game.blurb} Last place takes something off.</p>

      <div className="mt-5 flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl bg-black/30 p-5 text-center">
        {elapsed < 0 ? (
          <>
            <p className="text-sm font-bold uppercase tracking-widest text-white/50">Get ready</p>
            <p key={Math.ceil(-elapsed / 1000)} className="animate-pop font-display text-8xl font-black text-glow-amber">
              {Math.ceil(-elapsed / 1000)}
            </p>
            {view.mgType === 1 && (
              <p className="text-sm text-white/60">
                Target: <b className="text-white">{(engine.mgTarget(view.mgSeed) / 1000).toFixed(2)}s</b>
              </p>
            )}
          </>
        ) : view.mgType === 0 ? (
          <Mash {...props} />
        ) : view.mgType === 1 ? (
          <Clock {...props} />
        ) : view.mgType === 2 ? (
          <Reaction {...props} />
        ) : view.mgType === 3 ? (
          <Simon {...props} />
        ) : view.mgType === 4 ? (
          <Maths {...props} />
        ) : (
          <Targets {...props} />
        )}
      </div>

      <p className="mt-3 text-center text-xs text-white/45">
        {waiting} player{waiting === 1 ? "" : "s"} still playing{view.mgType === 0 || view.mgType === 1 || view.mgType === 2 ? " · space bar works too" : ""}
      </p>
    </Modal>
  );
}

function useSpace(handler: () => void, enabled: boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

const LockedIn = () => <p className="text-sm text-white/55">Locked in. Waiting for others...</p>;

// ---------------------------------------------------------------- 0 Tap Frenzy
const MASH_MS = 5000;
function Mash({ elapsed, done, submit }: GameProps) {
  const [taps, setTaps] = useState(0);
  const count = useRef(0);
  const tap = useCallback(() => {
    if (done || elapsed < 0 || elapsed > MASH_MS) return;
    count.current += 1;
    setTaps(count.current);
  }, [done, elapsed]);
  useSpace(tap, !done);
  useEffect(() => {
    if (elapsed >= MASH_MS) submit(count.current);
  }, [elapsed, submit]);
  return (
    <>
      <p className="font-display text-6xl font-black tabular-nums">{taps}</p>
      <p className="text-sm text-white/55">{done ? "Time!" : `${Math.max(0, (MASH_MS - elapsed) / 1000).toFixed(1)}s left`}</p>
      <button className="btn-primary h-24 w-full max-w-xs select-none text-2xl" disabled={done} onPointerDown={tap}>
        TAP!
      </button>
      {done && <LockedIn />}
    </>
  );
}

// ------------------------------------------------------------ 1 Stop the Clock
function Clock({ engine, seed, elapsed, done, submit }: GameProps) {
  const target = engine.mgTarget(seed);
  const stop = useCallback(() => {
    if (!done && elapsed >= 0) submit(Math.round(elapsed));
  }, [done, elapsed, submit]);
  useSpace(stop, !done);
  useEffect(() => {
    if (elapsed >= 12000) submit(-1);
  }, [elapsed, submit]);
  return (
    <>
      <p className="text-sm text-white/60">
        Stop at <b className="text-white">{(target / 1000).toFixed(2)}s</b>
      </p>
      <p className="font-display text-6xl font-black tabular-nums">{elapsed > 2000 ? "?.??" : (Math.max(0, elapsed) / 1000).toFixed(2)}</p>
      <button className="btn-primary h-24 w-full max-w-xs select-none text-2xl" disabled={done} onPointerDown={stop}>
        STOP
      </button>
      {done && <LockedIn />}
    </>
  );
}

// ------------------------------------------------------------------ 2 Quick Draw
function Reaction({ engine, seed, elapsed, done, submit }: GameProps) {
  const delay = engine.mgReactionDelay(seed);
  const lit = elapsed >= delay;
  const [early, setEarly] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const press = useCallback(() => {
    if (done || elapsed < 0) return;
    if (elapsed < delay) {
      setEarly(true);
      submit(-1); // false start
    } else {
      const r = Math.round(elapsed - delay);
      setMs(r);
      submit(r);
    }
  }, [done, elapsed, delay, submit]);
  useSpace(press, !done);
  useEffect(() => {
    if (elapsed > delay + 3000) submit(-1);
  }, [elapsed, delay, submit]);
  return (
    <>
      <button
        onPointerDown={press}
        disabled={done}
        className={`h-40 w-full max-w-xs select-none rounded-3xl font-display text-3xl font-black transition-colors disabled:opacity-100 ${
          early ? "bg-red-600 text-white" : lit && !done ? "bg-emerald-400 text-ink-950" : done ? "bg-white/10 text-white" : "bg-rose-900/70 text-white/80"
        }`}
      >
        {early ? "Too early!" : ms !== null ? `${ms} ms` : lit ? "TAP NOW!" : "Wait for green..."}
      </button>
      {done && <LockedIn />}
    </>
  );
}

// ------------------------------------------------------------------- 3 Simon Says
const PAD_COLORS = ["bg-rose-500", "bg-sky-400", "bg-amber-300", "bg-emerald-400"];
const SIMON_WINDOW_MS = 18000;
const SIMON_ITEM_MS = 450;
function Simon({ engine, seed, elapsed, done, submit }: GameProps) {
  const seq = useRef<number[]>(Array.from({ length: 12 }, (_, i) => engine.mgRand(seed, i, 4)));
  const [level, setLevel] = useState(1);
  const [stage, setStage] = useState<"show" | "input" | "over">("show");
  const [lit, setLit] = useState(-1);
  const [inputIdx, setInputIdx] = useState(0);

  useEffect(() => {
    if (stage !== "show" || done) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let k = 0; k < level; k++) {
      timers.push(setTimeout(() => setLit(seq.current[k]), 500 + k * SIMON_ITEM_MS));
      timers.push(setTimeout(() => setLit(-1), 500 + k * SIMON_ITEM_MS + 330));
    }
    timers.push(
      setTimeout(() => {
        setInputIdx(0);
        setStage("input");
      }, 500 + level * SIMON_ITEM_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [stage, level, done]);

  useEffect(() => {
    if (elapsed >= SIMON_WINDOW_MS) submit(level - 1);
  }, [elapsed, level, submit]);

  const press = (c: number) => {
    if (stage !== "input" || done) return;
    setLit(c);
    setTimeout(() => setLit(-1), 150);
    if (c !== seq.current[inputIdx]) {
      setStage("over");
      submit(level - 1);
    } else if (inputIdx + 1 === level) {
      if (level === 12) {
        setStage("over");
        submit(12);
      } else {
        setLevel(level + 1);
        setStage("show");
      }
    } else setInputIdx(inputIdx + 1);
  };

  return (
    <>
      <p className="text-sm text-white/60">
        {done ? (stage === "over" && inputIdx >= 0 ? `You reached ${level - 1} step${level - 1 === 1 ? "" : "s"}` : "Time!") : stage === "show" ? `Watch... (${level} step${level === 1 ? "" : "s"})` : `Your turn: ${inputIdx}/${level}`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {PAD_COLORS.map((c, i) => (
          <button
            key={i}
            aria-label={`Pad ${i + 1}`}
            disabled={stage !== "input" || done}
            onPointerDown={() => press(i)}
            className={`h-24 w-24 select-none rounded-2xl transition disabled:opacity-100 ${c} ${lit === i ? "scale-105 brightness-150 ring-4 ring-white" : "opacity-45"}`}
          />
        ))}
      </div>
      {done && <LockedIn />}
    </>
  );
}

// ------------------------------------------------------------------ 4 Quick Maths
const MATHS_MS = 15000;
function question(engine: Engine, seed: number, i: number) {
  const base = 400 + i * 10;
  const r = (k: number, mod: number) => engine.mgRand(seed, base + k, mod);
  const op = r(0, 3);
  let a: number, b: number, ans: number, text: string;
  if (op === 0) {
    a = 10 + r(1, 50);
    b = 10 + r(2, 50);
    ans = a + b;
    text = `${a} + ${b}`;
  } else if (op === 1) {
    a = 20 + r(1, 60);
    b = 1 + r(2, a - 1);
    ans = a - b;
    text = `${a} − ${b}`;
  } else {
    a = 2 + r(1, 11);
    b = 2 + r(2, 11);
    ans = a * b;
    text = `${a} × ${b}`;
  }
  const options = [ans];
  for (const off of [1 + r(3, 5), -(1 + r(4, 5)), (r(5, 2) ? 1 : -1) * (6 + r(6, 5))]) {
    let v = ans + off;
    while (options.includes(v) || v < 0) v += 7;
    options.push(v);
  }
  const pos = r(7, 4);
  [options[0], options[pos]] = [options[pos], options[0]];
  return { text, ans, options };
}

function Maths({ engine, seed, elapsed, done, submit }: GameProps) {
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const q = question(engine, seed, i);
  useEffect(() => {
    if (elapsed >= MATHS_MS) submit(scoreRef.current);
  }, [elapsed, submit]);
  const pick = (v: number) => {
    if (done || elapsed >= MATHS_MS) return;
    scoreRef.current = Math.max(0, scoreRef.current + (v === q.ans ? 1 : -1));
    setScore(scoreRef.current);
    setI(i + 1);
  };
  return (
    <>
      <p className="text-sm text-white/55">
        {done ? "Time!" : `${Math.max(0, (MATHS_MS - elapsed) / 1000).toFixed(1)}s left`} · score <b className="text-white">{score}</b>
      </p>
      <p className="font-display text-5xl font-black tabular-nums">{done ? "Done" : q.text}</p>
      <div className="grid w-full max-w-xs grid-cols-2 gap-2">
        {q.options.map((o) => (
          <button key={o} className="btn-ghost select-none py-4 text-xl" disabled={done} onPointerDown={() => pick(o)}>
            {o}
          </button>
        ))}
      </div>
      {done && <LockedIn />}
    </>
  );
}

// ------------------------------------------------------------- 5 Whack-a-Target
const TARGETS = 10;
function Targets({ engine, seed, elapsed, done, submit }: GameProps) {
  const [hit, setHit] = useState(0);
  const cell = engine.mgCell(seed, Math.min(hit, TARGETS - 1));
  useEffect(() => {
    if (elapsed >= 14000) submit(-1);
  }, [elapsed, submit]);
  const press = (c: number) => {
    if (done || elapsed < 0 || c !== cell) return;
    if (hit + 1 === TARGETS) submit(Math.round(elapsed));
    setHit(hit + 1);
  };
  return (
    <>
      <p className="text-sm text-white/55">
        {Math.min(hit, TARGETS)}/{TARGETS} · {(Math.max(0, elapsed) / 1000).toFixed(1)}s
      </p>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, c) => (
          <button
            key={c}
            aria-label={c === cell && !done ? "Target" : "Empty"}
            disabled={done}
            onPointerDown={() => press(c)}
            className={`h-20 w-20 select-none rounded-2xl transition disabled:opacity-100 ${c === cell && !done ? "scale-105 bg-glow-pink shadow-lg shadow-glow-pink/50" : "bg-white/10"}`}
          />
        ))}
      </div>
      {done && <LockedIn />}
    </>
  );
}
