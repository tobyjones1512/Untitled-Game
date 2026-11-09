import { GAME_WASM_BASE64 } from "./embedded";

/** Game phases, mirrored from assembly/index.ts. */
export const Phase = {
  LOBBY: 0,
  ROLL: 1,
  SHOP: 2,
  MINI: 3,
  STRIP: 4,
  OVER: 5,
  /** everyone rolls once to decide turn order */
  ORDER: 6,
} as const;

export const ITEMS = [
  { id: 0, name: "Shirt", icon: "👕" },
  { id: 1, name: "Pants / Skirt", icon: "👖" },
  { id: 2, name: "Underwear", icon: "🩲" },
  { id: 3, name: "Shoes", icon: "👟" },
  { id: 4, name: "Socks", icon: "🧦" },
  { id: 5, name: "Bra", icon: "👙" },
] as const;

export const MINIGAMES = [
  { id: 0, name: "Tap Frenzy", blurb: "Mash the button as many times as you can in 5 seconds." },
  { id: 1, name: "Stop the Clock", blurb: "The timer hides after 2 seconds. Stop it as close to the target as you can." },
  { id: 2, name: "Quick Draw", blurb: "Wait for the screen to turn green, then tap as fast as you can. Tap early and you're out." },
  { id: 3, name: "Simon Says", blurb: "Watch the pattern, then repeat it. It gets one step longer each round." },
  { id: 4, name: "Quick Maths", blurb: "Answer as many sums as you can in 15 seconds." },
  { id: 5, name: "Whack-a-Target", blurb: "Hit 10 targets as fast as you can. Each one jumps to a new spot." },
] as const;

/** Human-readable result for the results table. */
export function describeResult(type: number, raw: number, score: number): string {
  if (type === 0) return `${raw} taps`;
  if (type === 1) return score > 0 ? `${(raw / 1000).toFixed(2)}s` : "DNF";
  if (type === 2) return score > 0 ? `${raw}ms` : "false start";
  if (type === 3) return `${raw} step${raw === 1 ? "" : "s"}`;
  if (type === 4) return `${raw} correct`;
  return score > 0 ? `${(raw / 1000).toFixed(1)}s` : "DNF";
}

export type Gender = "man" | "woman";

// state layout, mirrored from assembly/index.ts
const HEADER = 16;
const STRIDE = 20;

export interface PlayerView {
  index: number;
  alive: boolean;
  coins: number;
  pos: number;
  gender: Gender;
  items: number[]; // counts per ITEMS entry
  total: number;
  mgRaw: number;
  mgScore: number;
  mgDone: boolean;
  mgRank: number;
  /** item voted for + 1 (0 = not voted) */
  vote: number;
  /** turn-order roll (0 = hasn't rolled) */
  orderRoll: number;
  /** turn position, 0 = goes first */
  seat: number;
}

export interface GameView {
  phase: number;
  n: number;
  cur: number;
  round: number;
  lastRoll: number;
  stripTarget: number;
  winner: number;
  mgType: number;
  mgSeed: number;
  returnPhase: number;
  stripper: number;
  lastSpace: number;
  lastDelta: number;
  mgWinner: number;
  /** item chosen by the vote, -1 while voting is open */
  voteItem: number;
  players: PlayerView[];
}

export function decodeState(s: number[]): GameView {
  const n = s[1];
  const players: PlayerView[] = [];
  for (let i = 0; i < n; i++) {
    const b = HEADER + i * STRIDE;
    players.push({
      index: i,
      alive: s[b] === 1,
      coins: s[b + 1],
      pos: s[b + 2],
      gender: s[b + 3] === 1 ? "woman" : "man",
      items: s.slice(b + 4, b + 10),
      total: s[b + 10],
      mgRaw: s[b + 11],
      mgScore: s[b + 12],
      mgDone: s[b + 13] === 1,
      mgRank: s[b + 14],
      vote: s[b + 15],
      orderRoll: s[b + 16],
      seat: s[b + 17],
    });
  }
  return {
    phase: s[0],
    n,
    cur: s[2],
    round: s[3],
    lastRoll: s[4],
    stripTarget: s[5],
    winner: s[6],
    mgType: s[8],
    mgSeed: s[9],
    returnPhase: s[10],
    stripper: s[11],
    lastSpace: s[12],
    lastDelta: s[13],
    mgWinner: s[14],
    voteItem: s[15],
    players,
  };
}

interface WasmExports {
  memory: WebAssembly.Memory;
  statePtr(): number;
  stateSize(): number;
  boardSize(): number;
  spaceType(i: number): number;
  startCount(item: number, gender: number): number;
  costRestore(): number;
  costForce(): number;
  blueCoins(): number;
  redCoins(): number;
  mgTarget(seed: number): number;
  mgScore(type: number, raw: number, seed: number): number;
  initGame(n: number, seed: number, femaleMask: number): number;
  actRoll(p: number, roll: number, entropy: number): number;
  actOrderRoll(p: number, roll: number): number;
  mgRand(seed: number, i: number, mod: number): number;
  mgCell(seed: number, i: number): number;
  mgReactionDelay(seed: number): number;
  actShopBuy(p: number, item: number): number;
  actShopForce(p: number, target: number): number;
  actShopLeave(p: number): number;
  actSubmit(p: number, raw: number): number;
  actStrip(p: number, item: number): number;
  actForfeit(p: number): number;
  actVote(p: number, item: number): number;
  actVoteClose(): number;
  canRemove(p: number, item: number): number;
  canRestore(p: number, item: number): number;
}

export interface ActionResult {
  /** >= 0 on success, negative error code otherwise. */
  code: number;
  state: number[];
}

export const ERRORS: Record<number, string> = {
  [-1]: "That isn't allowed in this phase.",
  [-2]: "It isn't your move.",
  [-3]: "Invalid choice.",
  [-4]: "Not enough coins, or nothing to do.",
  [-5]: "That item can't come off (or go back on) yet - clothes have an order.",
};

/** Thin stateless wrapper: load a state array, run one Wasm action, read it back. */
export class Engine {
  constructor(private readonly ex: WasmExports) {}

  private view(): Int32Array {
    return new Int32Array(this.ex.memory.buffer, this.ex.statePtr(), this.ex.stateSize());
  }

  private run(state: number[], fn: (ex: WasmExports) => number): ActionResult {
    this.view().set(state);
    const code = fn(this.ex);
    return { code, state: Array.from(this.view()) };
  }

  get boardSize() {
    return this.ex.boardSize();
  }
  spaceType(i: number) {
    return this.ex.spaceType(i);
  }
  startCount(item: number, gender: Gender) {
    return this.ex.startCount(item, gender === "woman" ? 1 : 0);
  }
  get costRestore() {
    return this.ex.costRestore();
  }
  get costForce() {
    return this.ex.costForce();
  }
  get blueCoins() {
    return this.ex.blueCoins();
  }
  get redCoins() {
    return this.ex.redCoins();
  }
  mgTarget(seed: number) {
    return this.ex.mgTarget(seed);
  }
  mgScore(type: number, raw: number, seed: number) {
    return this.ex.mgScore(type, raw, seed);
  }

  init(genders: Gender[], seed: number): ActionResult {
    const mask = genders.reduce((m, g, i) => (g === "woman" ? m | (1 << i) : m), 0);
    return this.run(new Array(this.ex.stateSize()).fill(0), (ex) => ex.initGame(genders.length, seed | 0, mask));
  }
  roll(s: number[], p: number, face: number, entropy: number) {
    return this.run(s, (ex) => ex.actRoll(p, face, entropy));
  }
  orderRoll(s: number[], p: number, face: number) {
    return this.run(s, (ex) => ex.actOrderRoll(p, face));
  }
  mgRand(seed: number, i: number, mod: number) {
    return this.ex.mgRand(seed, i, mod);
  }
  mgCell(seed: number, i: number) {
    return this.ex.mgCell(seed, i);
  }
  mgReactionDelay(seed: number) {
    return this.ex.mgReactionDelay(seed);
  }
  buy(s: number[], p: number, item: number) {
    return this.run(s, (ex) => ex.actShopBuy(p, item));
  }
  force(s: number[], p: number, target: number) {
    return this.run(s, (ex) => ex.actShopForce(p, target));
  }
  leaveShop(s: number[], p: number) {
    return this.run(s, (ex) => ex.actShopLeave(p));
  }
  submit(s: number[], p: number, raw: number) {
    return this.run(s, (ex) => ex.actSubmit(p, raw));
  }
  strip(s: number[], p: number, item: number) {
    return this.run(s, (ex) => ex.actStrip(p, item));
  }
  vote(s: number[], p: number, item: number) {
    return this.run(s, (ex) => ex.actVote(p, item));
  }
  voteClose(s: number[]) {
    return this.run(s, (ex) => ex.actVoteClose());
  }
  /** Can player p take this item off right now (respecting clothing order)? */
  canRemove(s: number[], p: number, item: number): boolean {
    this.view().set(s);
    return this.ex.canRemove(p, item) !== 0;
  }
  /** Can player p put this item back on right now? */
  canRestore(s: number[], p: number, item: number): boolean {
    this.view().set(s);
    return this.ex.canRestore(p, item) !== 0;
  }
  forfeit(s: number[], p: number) {
    return this.run(s, (ex) => ex.actForfeit(p));
  }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cached: Promise<Engine> | null = null;

/** Instantiates the embedded Wasm module once (async: browsers reject big sync compiles). */
export function getEngine(): Promise<Engine> {
  if (!cached) {
    cached = WebAssembly.instantiate(decodeBase64(GAME_WASM_BASE64) as BufferSource, {}).then(
      ({ instance }) => new Engine(instance.exports as unknown as WasmExports),
    );
  }
  return cached;
}
