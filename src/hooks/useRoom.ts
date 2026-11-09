"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRoom, SignalMessage } from "@/lib/types";
import type { Creds } from "@/lib/client/session";

export type Connection = "connecting" | "live" | "denied";

/**
 * Subscribes to the room's Server-Sent Events stream. Streams are short lived
 * on Vercel (~50s) so EventSource reconnection is part of normal operation.
 * Signalling messages that arrive before WebcamGrid is ready are buffered.
 */
export function useRoom(code: string, creds: Creds | null) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [deniedReason, setDeniedReason] = useState("");
  const offset = useRef(0);
  const subs = useRef(new Set<(m: SignalMessage) => void>());
  const buffer = useRef<SignalMessage[]>([]);

  useEffect(() => {
    if (!creds) return;
    const url = `/api/rooms/${code}/events?playerId=${encodeURIComponent(creds.playerId)}&token=${encodeURIComponent(creds.token)}`;
    const es = new EventSource(url);

    es.addEventListener("open", () => setConnection("live"));
    es.addEventListener("state", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as PublicRoom;
      offset.current = r.serverNow - Date.now();
      setRoom((prev) => (prev && prev.version > r.version ? prev : r));
      setConnection("live");
    });
    es.addEventListener("signal", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as SignalMessage;
      if (subs.current.size === 0) buffer.current.push(m);
      else subs.current.forEach((cb) => cb(m));
    });
    es.addEventListener("denied", (e) => {
      setDeniedReason((JSON.parse((e as MessageEvent).data) as { error: string }).error);
      setConnection("denied");
      es.close();
    });
    es.addEventListener("error", () => setConnection((c) => (c === "denied" ? c : "connecting")));

    return () => es.close();
  }, [code, creds]);

  /** Apply a fresher room from an action response without waiting for SSE. */
  const applyRoom = useCallback((r: PublicRoom | null) => {
    if (!r) return;
    offset.current = r.serverNow - Date.now();
    setRoom((prev) => (prev && prev.version > r.version ? prev : r));
  }, []);

  /** Fetch the latest snapshot now (used when a peer pokes us over WebRTC). */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      if (res.ok) applyRoom((await res.json()) as PublicRoom);
    } catch {
      /* the SSE fallback will catch up */
    }
  }, [code, applyRoom]);

  const subscribeSignals = useCallback((cb: (m: SignalMessage) => void) => {
    subs.current.add(cb);
    const pending = buffer.current.splice(0);
    pending.forEach(cb);
    return () => {
      subs.current.delete(cb);
    };
  }, []);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { room, connection, deniedReason, applyRoom, refresh, subscribeSignals, serverNow };
}
