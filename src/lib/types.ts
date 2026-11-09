import type { Gender } from "./wasm/engine";

export interface PublicPlayer {
  id: string;
  name: string;
  gender: Gender;
  index: number;
}

export type LogKind = "info" | "roll" | "mini" | "strip" | "shop" | "win";

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  msg: string;
  playerId?: string;
  value?: number;
}

export interface PublicRoom {
  code: string;
  version: number;
  hostId: string;
  status: "lobby" | "playing" | "over";
  players: PublicPlayer[];
  /** Flat Wasm state array; decode with decodeState(). Null in the lobby. */
  state: number[] | null;
  mgStartedAt: number | null;
  mgDeadline: number | null;
  voteDeadline: number | null;
  serverNow: number;
  log: LogEntry[];
}

export type ActionBody =
  | { type: "start" }
  | { type: "leaveLobby" }
  | { type: "roll" }
  | { type: "buy"; item: number }
  | { type: "force"; target: number }
  | { type: "leaveShop" }
  | { type: "submit"; raw: number }
  | { type: "vote"; item: number }
  | { type: "voteTimeout" }
  | { type: "strip"; item: number }
  | { type: "forfeit" }
  | { type: "mgTimeout" };

export interface SignalMessage {
  from: string;
  data: unknown;
}
