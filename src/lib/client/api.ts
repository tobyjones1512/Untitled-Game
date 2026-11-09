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
