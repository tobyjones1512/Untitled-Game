"use client";

import { useEffect, useState } from "react";
import { getEngine, type Engine } from "@/lib/wasm/engine";

/** Loads the Wasm rules engine in the browser (used for UI costs, board, scoring previews). */
export function useEngine(): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => {
    let live = true;
    getEngine().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);
  return engine;
}
