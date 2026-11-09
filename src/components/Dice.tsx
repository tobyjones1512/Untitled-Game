"use client";

import { useEffect, useRef, useState } from "react";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Tumbles for ~0.9s whenever rollId changes, then settles on `value`. */
export function Dice({ value, rollId, onSettled }: { value: number; rollId: number; onSettled?: () => void }) {
  const [shown, setShown] = useState(value || 1);
  const [rolling, setRolling] = useState(false);
  const seen = useRef(rollId);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (rollId === seen.current) return;
    seen.current = rollId;
    setRolling(true);
    const tick = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 75);
    const done = setTimeout(() => {
      clearInterval(tick);
      setShown(latest.current || 1);
      setRolling(false);
      onSettled?.();
    }, 900);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [rollId, onSettled]);

  return (
    <div
      role="img"
      aria-label={`Dice showing ${shown}`}
      className={`grid h-16 w-16 grid-cols-3 grid-rows-3 gap-1 rounded-2xl bg-white p-2 shadow-lg shadow-black/40 ${rolling ? "animate-shake" : ""}`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`m-auto h-2.5 w-2.5 rounded-full ${PIPS[shown]?.includes(i) ? "bg-ink-900" : "bg-transparent"}`} />
      ))}
    </div>
  );
}
