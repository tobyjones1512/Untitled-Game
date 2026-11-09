import type { Gender } from "../wasm/engine";
import type { ActionBody, PublicRoom } from "../types";
import type { Creds } from "./session";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface Joined extends Creds {
  code: string;
}

export const createRoom = (name: string, gender: Gender, consent: boolean) =>
  post<Joined>("/api/rooms", { name, gender, consent });

export const joinRoom = (code: string, name: string, gender: Gender, consent: boolean) =>
  post<Joined>(`/api/rooms/${code}/join`, { name, gender, consent });

export const sendAction = (code: string, c: Creds, action: ActionBody) =>
  post<{ room: PublicRoom | null }>(`/api/rooms/${code}/action`, { ...c, action });

export const sendSignal = (code: string, c: Creds, to: string, data: unknown) =>
  post<{ ok: true }>(`/api/rooms/${code}/signal`, { ...c, to, data });

export interface MatchConfig {
  enabled: boolean;
  verified: boolean;
  verifyUrl: string | null;
  dev: boolean;
}

export async function getMatchConfig(): Promise<MatchConfig> {
  const res = await fetch("/api/match/config", { cache: "no-store" });
  return res.ok ? ((await res.json()) as MatchConfig) : { enabled: false, verified: false, verifyUrl: null, dev: false };
}

export const devVerify = () => post<{ ok: true }>("/api/age/dev", {});

export const joinQueue = (name: string, gender: Gender, consent: boolean) =>
  post<{ ticket: string }>("/api/match/join", { name, gender, consent });

export type MatchStatus =
  | { state: "waiting"; waiting: number }
  | { state: "matched"; code: string; playerId: string; token: string }
  | { state: "gone" };

export async function getMatchStatus(ticket: string): Promise<MatchStatus> {
  const res = await fetch(`/api/match/status?ticket=${encodeURIComponent(ticket)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as MatchStatus) : { state: "gone" };
}

export const cancelQueue = (ticket: string) => post<{ ok: true }>("/api/match/cancel", { ticket });

export const reportPlayer = (code: string, c: Creds, targetId: string, reason: string) =>
  post<{ ok: true }>("/api/report", { code, ...c, targetId, reason });
