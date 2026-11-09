import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { exec, run, type Cmd } from "./store";
import { Phase, MINIGAMES, ITEMS, decodeState, getEngine, ERRORS, type Gender } from "../wasm/engine";
import type { ActionBody, LogEntry, LogKind, PublicRoom } from "../types";

const ROOM_TTL_S = 6 * 60 * 60;
const MAX_PLAYERS = 4;
const MAX_LOG = 40;
const MG_COUNTDOWN_MS = 3000;
const MG_DEADLINE_MS = 22_000;
// breathing room between the last move of a lap and the minigame popping up
const MG_PAUSE_MS = 4000;
const VOTE_MS = 30_000;

interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  gender: Gender;
}

interface RoomDoc {
  code: string;
  version: number;
  hostId: string;
  status: "lobby" | "playing" | "over";
  players: RoomPlayer[];
  state: number[] | null;
  mgStartedAt: number | null;
  mgDeadline: number | null;
  voteDeadline: number | null;
  nextLogId: number;
  log: LogEntry[];
}

export class RoomError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const roomKey = (code: string) => `room:${code}`;
const lockKey = (code: string) => `lock:${code}`;
export const sigKey = (code: string, playerId: string) => `sig:${code}:${playerId}`;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function cleanName(raw: unknown): string {
  const n = String(raw ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 16);
  if (!n) throw new RoomError("Pick a display name.");
  return n;
}

function cleanGender(raw: unknown): Gender {
  if (raw === "man" || raw === "woman") return raw;
  throw new RoomError("Pick man or woman (this decides your starting socks and bra).");
}

// ------------------------------------------------------------ persistence ---
export async function loadRoom(code: string): Promise<RoomDoc | null> {
  const raw = (await run(["GET", roomKey(code)])) as string | null;
  return raw ? (JSON.parse(raw) as RoomDoc) : null;
}

export function parseRoom(raw: string | null): RoomDoc | null {
  return raw ? (JSON.parse(raw) as RoomDoc) : null;
}

async function saveRoom(doc: RoomDoc): Promise<void> {
  doc.version += 1;
  await run(["SET", roomKey(doc.code), JSON.stringify(doc), "EX", ROOM_TTL_S]);
}

/** Serialise writers per room with a short Redis lock. */
async function withRoom<T>(code: string, fn: (doc: RoomDoc) => Promise<T>): Promise<T> {
  const token = randomUUID();
  let acquired = false;
  for (let i = 0; i < 40 && !acquired; i++) {
    acquired = (await run(["SET", lockKey(code), token, "NX", "PX", 4000])) === "OK";
    if (!acquired) await new Promise((r) => setTimeout(r, 60));
  }
  if (!acquired) throw new RoomError("Room is busy, try again.", 503);
  try {
    const doc = await loadRoom(code);
    if (!doc) throw new RoomError("Room not found.", 404);
    return await fn(doc);
  } finally {
    await run(["DEL", lockKey(code)]).catch(() => undefined);
  }
}

// ------------------------------------------------------------ public view ---
export function toPublic(doc: RoomDoc): PublicRoom {
  return {
    code: doc.code,
    version: doc.version,
    hostId: doc.hostId,
    status: doc.status,
    players: doc.players.map((p, index) => ({ id: p.id, name: p.name, gender: p.gender, index })),
    state: doc.state,
    mgStartedAt: doc.mgStartedAt,
    mgDeadline: doc.mgDeadline,
    voteDeadline: doc.voteDeadline ?? null,
    serverNow: Date.now(),
    log: doc.log,
  };
}

function authPlayer(doc: RoomDoc, playerId: string, token: string): number {
  const idx = doc.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || doc.players[idx].token !== token) throw new RoomError("Not authorised for this room.", 401);
  return idx;
}

export function authFromDoc(doc: RoomDoc | null, playerId: string, token: string): boolean {
  return !!doc && doc.players.some((p) => p.id === playerId && p.token === token);
}

function pushLog(doc: RoomDoc, kind: LogKind, msg: string, extra: Partial<LogEntry> = {}) {
  doc.log.push({ id: doc.nextLogId++, t: Date.now(), kind, msg, ...extra });
  if (doc.log.length > MAX_LOG) doc.log.splice(0, doc.log.length - MAX_LOG);
}

// -------------------------------------------------------------- lifecycle ---
export async function createRoom(nameRaw: unknown, genderRaw: unknown, consent: unknown) {
  if (consent !== true) throw new RoomError("You must confirm you are 18+ and consent to play.");
  const name = cleanName(nameRaw);
  const gender = cleanGender(genderRaw);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    const player: RoomPlayer = { id: randomBytes(6).toString("hex"), token: randomUUID(), name, gender };
    const doc: RoomDoc = {
      code,
      version: 0,
      hostId: player.id,
      status: "lobby",
      players: [player],
      state: null,
      mgStartedAt: null,
      mgDeadline: null,
      voteDeadline: null,
      nextLogId: 1,
      log: [],
    };
    pushLog(doc, "info", `${name} opened the room.`);
    doc.version = 1;
    const ok = await run(["SET", roomKey(code), JSON.stringify(doc), "NX", "EX", ROOM_TTL_S]);
    if (ok === "OK") return { code, playerId: player.id, token: player.token };
  }
  throw new RoomError("Could not allocate a room code.", 503);
}

export async function joinRoom(codeRaw: string, nameRaw: unknown, genderRaw: unknown, consent: unknown) {
  if (consent !== true) throw new RoomError("You must confirm you are 18+ and consent to play.");
  const code = normaliseCode(codeRaw);
  const name = cleanName(nameRaw);
  const gender = cleanGender(genderRaw);
  return withRoom(code, async (doc) => {
    if (doc.status !== "lobby") throw new RoomError("That game has already started.", 409);
    if (doc.players.length >= MAX_PLAYERS) throw new RoomError("Room is full (4 players max).", 409);
    if (doc.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new RoomError("Someone in the room already has that name.", 409);
    }
    const player: RoomPlayer = { id: randomBytes(6).toString("hex"), token: randomUUID(), name, gender };
    doc.players.push(player);
    pushLog(doc, "info", `${name} joined.`);
    await saveRoom(doc);
    return { code, playerId: player.id, token: player.token };
  });
}

export async function getPublicRoom(codeRaw: string): Promise<PublicRoom> {
  const doc = await loadRoom(normaliseCode(codeRaw));
  if (!doc) throw new RoomError("Room not found.", 404);
  return toPublic(doc);
}

export async function sendSignal(codeRaw: string, playerId: string, token: string, to: string, data: unknown) {
  const code = normaliseCode(codeRaw);
  const doc = await loadRoom(code);
  if (!doc) throw new RoomError("Room not found.", 404);
  authPlayer(doc, playerId, token);
  if (to === playerId || !doc.players.some((p) => p.id === to)) throw new RoomError("Unknown peer.");
  const payload = JSON.stringify({ from: playerId, data });
  if (payload.length > 16_000) throw new RoomError("Signal too large.");
  const key = sigKey(code, to);
  await exec([
    ["RPUSH", key, payload],
    ["EXPIRE", key, 120],
  ] as Cmd[]);
}

// ---------------------------------------------------------------- actions ---
export async function applyAction(codeRaw: string, playerId: string, token: string, body: ActionBody) {
  const code = normaliseCode(codeRaw);
  const engine = await getEngine();
  return withRoom(code, async (doc) => {
    const me = authPlayer(doc, playerId, token);
    const myName = doc.players[me].name;

    // ----- lobby actions
    if (body.type === "start") {
      if (doc.status !== "lobby") throw new RoomError("Already started.", 409);
      if (doc.hostId !== playerId) throw new RoomError("Only the host can start.", 403);
      if (doc.players.length < 2) throw new RoomError("Need at least 2 players.");
      const seed = randomInt(1, 2 ** 31 - 1);
      const init = engine.init(
        doc.players.map((p) => p.gender),
        seed,
      );
      if (init.code < 0) throw new RoomError(ERRORS[init.code] ?? "Could not start.");
      doc.state = init.state;
      doc.status = "playing";
      pushLog(doc, "info", `The game begins! ${doc.players[0].name} goes first. Everyone starts with 7 items.`);
      await saveRoom(doc);
      return toPublic(doc);
    }

    if (body.type === "leaveLobby") {
      if (doc.status !== "lobby") throw new RoomError("Use tap out once the game has started.", 409);
      doc.players.splice(me, 1);
      if (doc.players.length === 0) {
        await run(["DEL", roomKey(code)]);
        return null;
      }
      if (doc.hostId === playerId) doc.hostId = doc.players[0].id;
      pushLog(doc, "info", `${myName} left.`);
      await saveRoom(doc);
      return toPublic(doc);
    }

    // ----- in-game actions
    if (doc.status !== "playing" || !doc.state) throw new RoomError("The game isn't running.", 409);
    const before = decodeState(doc.state);
    const now = Date.now();
    let res;

    switch (body.type) {
      case "roll":
        res = engine.roll(doc.state, me);
        break;
      case "buy":
        res = engine.buy(doc.state, me, Number(body.item));
        break;
      case "force":
        res = engine.force(doc.state, me, Number(body.target));
        break;
      case "leaveShop":
        res = engine.leaveShop(doc.state, me);
        break;
      case "vote":
        res = engine.vote(doc.state, me, Number(body.item));
        break;
      case "voteTimeout":
        if (before.phase !== Phase.STRIP || before.voteItem >= 0 || !doc.voteDeadline || now < doc.voteDeadline) {
          throw new RoomError("Voting is still open.", 409);
        }
        res = engine.voteClose(doc.state);
        break;
      case "strip":
        res = engine.strip(doc.state, me, Number(body.item));
        break;
      case "forfeit":
        res = engine.forfeit(doc.state, me);
        break;
      case "submit": {
        if (before.phase === Phase.MINI && doc.mgStartedAt) {
          const playFrom = doc.mgStartedAt + MG_COUNTDOWN_MS;
          // a 5s mash can't honestly finish before ~4.5s after the countdown
          if (before.mgType === 0 && now < playFrom + 4500) throw new RoomError("Too early.");
        }
        res = engine.submit(doc.state, me, Math.trunc(Number(body.raw)));
        break;
      }
      case "mgTimeout": {
        if (before.phase !== Phase.MINI || !doc.mgDeadline || now < doc.mgDeadline) {
          throw new RoomError("Not timed out yet.", 409);
        }
        let s = doc.state;
        for (const p of before.players) {
          if (p.alive && !p.mgDone) s = engine.submit(s, p.index, -1).state;
        }
        res = { code: 0, state: s };
        break;
      }
      default:
        throw new RoomError("Unknown action.");
    }

    if (res.code < 0) throw new RoomError(ERRORS[res.code] ?? "Action rejected.", 409);
    doc.state = res.state;
    const after = decodeState(res.state);
    narrate(doc, before, after, body, me, res.code);

    if (after.phase === Phase.MINI && before.phase !== Phase.MINI) {
      // pause so everyone can see the last move before the minigame takes over
      doc.mgStartedAt = now + MG_PAUSE_MS;
      doc.mgDeadline = doc.mgStartedAt + MG_DEADLINE_MS;
    } else if (after.phase !== Phase.MINI) {
      doc.mgStartedAt = null;
      doc.mgDeadline = null;
    }
    if (after.phase === Phase.STRIP && after.voteItem < 0) {
      if (before.phase !== Phase.STRIP || before.voteItem >= 0 || !doc.voteDeadline) doc.voteDeadline = now + VOTE_MS;
    } else {
      doc.voteDeadline = null;
    }
    if (after.phase === Phase.OVER) doc.status = "over";

    await saveRoom(doc);
    return toPublic(doc);
  });
}

function narrate(doc: RoomDoc, before: ReturnType<typeof decodeState>, after: ReturnType<typeof decodeState>, body: ActionBody, me: number, code: number) {
  const name = (i: number) => doc.players[i]?.name ?? "?";
  const id = (i: number) => doc.players[i]?.id;
  const spaceLabel = ["a blue space", "a red space", "the Tailor Shop", "Start"];

  switch (body.type) {
    case "roll": {
      const delta = after.lastDelta;
      const tail =
        after.lastSpace === 0
          ? ` and won ${delta} coins`
          : after.lastSpace === 1
            ? delta < 0
              ? ` and lost ${-delta} coins`
              : " but had no coins to lose"
            : "";
      pushLog(doc, "roll", `${name(me)} rolled a ${code} and landed on ${spaceLabel[after.lastSpace]}${tail}.`, {
        playerId: id(me),
        value: code,
      });
      break;
    }
    case "buy":
      pushLog(doc, "shop", `${name(me)} bought their ${ITEMS[body.item]?.name.toLowerCase()} back from the tailor.`, { playerId: id(me) });
      break;
    case "force":
      pushLog(doc, "shop", `${name(me)} paid the tailor to make ${name(body.target)} strip!`, { playerId: id(me) });
      break;
    case "leaveShop":
      pushLog(doc, "shop", `${name(me)} left the shop.`, { playerId: id(me) });
      break;
    case "strip": {
      const item = ITEMS[body.item]?.name.toLowerCase();
      pushLog(doc, "strip", `${name(me)} removed their ${item}. ${after.players[me].total} item${after.players[me].total === 1 ? "" : "s"} left.`, { playerId: id(me) });
      if (!after.players[me].alive) pushLog(doc, "strip", `${name(me)} is out of clothes and eliminated!`, { playerId: id(me) });
      break;
    }
    case "forfeit":
      pushLog(doc, "info", `${name(me)} tapped out. No questions asked.`, { playerId: id(me) });
      break;
    default:
      break;
  }

  if (before.phase === Phase.STRIP && before.voteItem < 0 && after.voteItem >= 0) {
    pushLog(doc, "strip", `The vote is in: ${name(after.stripTarget)} takes off their ${ITEMS[after.voteItem]?.name.toLowerCase()}.`, {
      playerId: id(after.stripTarget),
    });
  }
  if (before.phase === Phase.MINI && after.phase === Phase.STRIP) {
    pushLog(doc, "mini", `${name(after.mgWinner)} won the minigame (+5 coins). ${name(after.stripTarget)} came last. Everyone else votes on what comes off!`, {
      playerId: id(after.stripTarget),
    });
  }
  if (before.phase !== Phase.MINI && after.phase === Phase.MINI) {
    pushLog(doc, "mini", `Round ${after.round} minigame: ${MINIGAMES[after.mgType].name}! Everyone play at once.`);
  }
  if (after.phase === Phase.OVER) {
    pushLog(doc, "win", after.winner >= 0 ? `${name(after.winner)} is the last one dressed and wins the game!` : "Nobody is left standing. It's a draw!", {
      playerId: after.winner >= 0 ? id(after.winner) : undefined,
    });
  }
}
