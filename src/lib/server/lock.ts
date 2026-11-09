import { randomUUID } from "node:crypto";
import { run } from "./store";

/** Short Redis lock (SET NX PX). Throws if it can't be acquired in ~2.5s. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    ok = (await run(["SET", `lock:${key}`, token, "NX", "PX", 4000])) === "OK";
    if (!ok) await new Promise((r) => setTimeout(r, 60));
  }
  if (!ok) throw new Error("busy");
  try {
    return await fn();
  } finally {
    await run(["DEL", `lock:${key}`]).catch(() => undefined);
  }
}
