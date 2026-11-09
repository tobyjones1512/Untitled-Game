import { randomBytes, randomUUID } from "node:crypto";
import { run } from "./store";
import { withLock } from "./lock";
import { RoomError, createPublicRoom, cleanName, cleanGender } from "./rooms";
import type { Gender } from "../wasm/engine";

const QUEUE_KEY = "mm:queue";
const STALE_MS = 20_000; // a searching client polls every ~2s; silence for 20s = gone
const MIN_WAIT_MS = 8000; // give a 3rd/4th player a few seconds to arrive
const RESULT_KEEP_MS = 120_000;

interface Ticket {
  id: string;
  name: string;
  gender: Gender;
  at: number;
  seen: number;
  result?: { code: string; playerId: string; token: string; at: number };
}

async function load(): Promise<Ticket[]> {
  const raw = (await run(["GET", QUEUE_KEY])) as string | null;
  return raw ? (JSON.parse(raw) as Ticket[]) : [];
}

async function save(tickets: Ticket[]) {
  await run(["SET", QUEUE_KEY, JSON.stringify(tickets), "EX", 600]);
}

function prune(tickets: Ticket[], now: number): Ticket[] {
  return tickets.filter((t) => (t.result ? now - t.result.at < RESULT_KEEP_MS : now - t.seen < STALE_MS));
}

async function tryMatch(tickets: Ticket[], now: number) {
  const waiting = tickets.filter((t) => !t.result).sort((a, b) => a.at - b.at);
  let group: Ticket[] = [];
  if (waiting.length >= 4) group = waiting.slice(0, 4);
  else if (waiting.length >= 2 && now - waiting[0].at >= MIN_WAIT_MS) group = waiting;
  if (group.length < 2) return;

  const players = group.map((t) => ({ id: randomBytes(6).toString("hex"), token: randomUUID(), name: t.name, gender: t.gender }));
  // names must be unique inside a room
  const seen = new Set<string>();
  players.forEach((p, i) => {
    let n = p.name;
    while (seen.has(n.toLowerCase())) n = `${p.name.slice(0, 13)}${i + 2}`;
    seen.add(n.toLowerCase());
    p.name = n;
  });
  const code = await createPublicRoom(players);
  group.forEach((t, i) => (t.result = { code, playerId: players[i].id, token: players[i].token, at: now }));
}

export async function joinQueue(nameRaw: unknown, genderRaw: unknown, consent: unknown): Promise<string> {
  if (consent !== true) throw new RoomError("You must confirm you are 18+ and consent to play.");
  const name = cleanName(nameRaw);
  const gender = cleanGender(genderRaw);
  const now = Date.now();
  const ticket: Ticket = { id: randomBytes(10).toString("hex"), name, gender, at: now, seen: now };
  await withLock("mm", async () => {
    const tickets = prune(await load(), now);
    tickets.push(ticket);
    await tryMatch(tickets, now);
    await save(tickets);
  });
  return ticket.id;
}

export type MatchStatus = { state: "waiting"; waiting: number } | { state: "matched"; code: string; playerId: string; token: string } | { state: "gone" };

export async function matchStatus(id: string): Promise<MatchStatus> {
  const now = Date.now();
  return withLock("mm", async () => {
    const tickets = prune(await load(), now);
    const t = tickets.find((x) => x.id === id);
    if (!t) return { state: "gone" } as MatchStatus;
    t.seen = now;
    await tryMatch(tickets, now);
    await save(tickets);
    if (t.result) return { state: "matched", code: t.result.code, playerId: t.result.playerId, token: t.result.token };
    return { state: "waiting", waiting: tickets.filter((x) => !x.result).length };
  });
}

export async function cancelQueue(id: string) {
  await withLock("mm", async () => {
    const tickets = prune(await load(), Date.now()).filter((t) => t.id !== id || t.result);
    await save(tickets);
  });
}
