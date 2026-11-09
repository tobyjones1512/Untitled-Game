// Deterministic rules engine for the webcam board game.
// All game state lives in one flat i32 array so the host (browser or Vercel
// function) can load it, run exactly one action, and read it back. Nothing in
// here allocates or touches the clock, so the same state + action always
// produces the same result on every machine.

// ---------------------------------------------------------------- layout ---
const MAX_PLAYERS: i32 = 4;
const HEADER: i32 = 16;
const STRIDE: i32 = 16;
const SIZE: i32 = HEADER + MAX_PLAYERS * STRIDE; // 80

// header fields
const H_PHASE: i32 = 0;
const H_N: i32 = 1;
const H_CUR: i32 = 2;
const H_ROUND: i32 = 3;
const H_ROLL: i32 = 4;
const H_TARGET: i32 = 5; // player who must strip
const H_WINNER: i32 = 6;
const H_RNG: i32 = 7;
const H_MGTYPE: i32 = 8;
const H_MGSEED: i32 = 9;
const H_RETURN: i32 = 10; // phase to resume after a strip
const H_STRIPPER: i32 = 11; // who forced the strip (-1 = minigame loss)
const H_LASTSPACE: i32 = 12;
const H_LASTDELTA: i32 = 13;
const H_MGWINNER: i32 = 14;

// per-player fields
const F_ALIVE: i32 = 0;
const F_COINS: i32 = 1;
const F_POS: i32 = 2;
const F_GENDER: i32 = 3; // 0 = man, 1 = woman
const F_ITEMS: i32 = 4; // 6 counters: shirt, pants, underwear, shoes, socks, bra
const F_TOTAL: i32 = 10;
const F_MGRAW: i32 = 11;
const F_MGSCORE: i32 = 12;
const F_MGDONE: i32 = 13;
const F_MGRANK: i32 = 14;

// phases
const LOBBY: i32 = 0;
const ROLL: i32 = 1;
const SHOP: i32 = 2;
const MINI: i32 = 3;
const STRIP: i32 = 4;
const OVER: i32 = 5;

// economy
const BOARD: i32 = 24;
const BLUE_COINS: i32 = 3;
const RED_COINS: i32 = 3;
const RESTORE_COST: i32 = 5;
const FORCE_COST: i32 = 8;
const MG_WIN_BONUS: i32 = 5;

const ITEM_KINDS: i32 = 6;

const state = new StaticArray<i32>(SIZE);

// --------------------------------------------------------------- helpers ---
@inline function P(p: i32, f: i32): i32 {
  return HEADER + p * STRIDE + f;
}
@inline function g(i: i32): i32 {
  return unchecked(state[i]);
}
@inline function s(i: i32, v: i32): void {
  unchecked((state[i] = v));
}

function nextRand(): u32 {
  let x: u32 = <u32>g(H_RNG);
  if (x == 0) x = 0x9e3779b9;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  s(H_RNG, <i32>x);
  return x;
}

function mix(seed: i32, i: i32): u32 {
  let h: u32 = <u32>seed ^ (<u32>(i + 1) * 0x9e3779b1);
  h ^= h >> 15;
  h *= 0x85ebca6b;
  h ^= h >> 13;
  return h;
}

function aliveCount(): i32 {
  let c = 0;
  const n = g(H_N);
  for (let i = 0; i < n; i++) if (g(P(i, F_ALIVE)) == 1) c++;
  return c;
}

function nextAlive(from: i32): i32 {
  const n = g(H_N);
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (g(P(j, F_ALIVE)) == 1) return j;
  }
  return from;
}

function isPlayer(p: i32): bool {
  return p >= 0 && p < g(H_N);
}

// --------------------------------------------------------- public queries ---
export function statePtr(): usize {
  return changetype<usize>(state);
}
export function stateSize(): i32 {
  return SIZE;
}
export function boardSize(): i32 {
  return BOARD;
}

/** 0 = blue (+coins), 1 = red (-coins), 2 = tailor shop, 3 = start */
export function spaceType(i: i32): i32 {
  if (i == 0) return 3;
  if (i % 8 == 4) return 2;
  if (i % 3 == 0) return 1;
  return 0;
}

/** Items of a kind every player starts with. 7 total for either gender. */
export function startCount(item: i32, gender: i32): i32 {
  if (item == 0 || item == 1 || item == 2) return 1;
  if (item == 3) return 2;
  if (item == 4) return gender == 0 ? 2 : 1;
  if (item == 5) return gender == 1 ? 1 : 0;
  return 0;
}

export function costRestore(): i32 {
  return RESTORE_COST;
}
export function costForce(): i32 {
  return FORCE_COST;
}
export function blueCoins(): i32 {
  return BLUE_COINS;
}
export function redCoins(): i32 {
  return RED_COINS;
}

// ------------------------------------------------------------ minigames ---
/** Hidden target (ms) for the timing minigame. */
export function mgTarget(seed: i32): i32 {
  return 3000 + (seed & 0x7fffffff) % 4000;
}

/**
 * Normalised score, higher is better.
 * type 0 = 5 second button mash (raw = taps, capped at a humanly plausible 60)
 * type 1 = stop-the-clock (raw = ms when stopped, closest to mgTarget wins)
 */
export function mgScore(type: i32, raw: i32, seed: i32): i32 {
  if (raw < 0) return 0;
  if (type == 0) return min<i32>(raw, 60) * 1000;
  if (raw > 20000) return 0;
  const d = abs<i32>(raw - mgTarget(seed));
  return max<i32>(0, 10000 - d);
}

// ------------------------------------------------------------ transitions ---
function finish(): void {
  s(H_PHASE, OVER);
  let w = -1;
  if (aliveCount() == 1) {
    const n = g(H_N);
    for (let i = 0; i < n; i++) if (g(P(i, F_ALIVE)) == 1) w = i;
  }
  s(H_WINNER, w);
}

function checkOver(): bool {
  if (aliveCount() <= 1) {
    finish();
    return true;
  }
  return false;
}

function startMinigame(first: i32): void {
  s(H_CUR, first);
  s(H_PHASE, MINI);
  s(H_ROUND, g(H_ROUND) + 1);
  s(H_MGTYPE, <i32>(nextRand() % 2));
  s(H_MGSEED, <i32>(nextRand() & 0x7fffffff));
  s(H_MGWINNER, -1);
  const n = g(H_N);
  for (let i = 0; i < n; i++) {
    s(P(i, F_MGRAW), 0);
    s(P(i, F_MGSCORE), 0);
    s(P(i, F_MGDONE), 0);
    s(P(i, F_MGRANK), 0);
  }
}

// Passing the turn. When the turn order wraps, every living player has moved
// once, so the cycle ends with a free-for-all minigame.
function endTurn(): void {
  if (checkOver()) return;
  const cur = g(H_CUR);
  const nxt = nextAlive(cur);
  if (nxt <= cur) {
    startMinigame(nxt);
  } else {
    s(H_CUR, nxt);
    s(H_PHASE, ROLL);
  }
}

function afterStrip(): void {
  if (checkOver()) return;
  const cur = g(H_CUR);
  const curAlive = g(P(cur, F_ALIVE)) == 1;
  if (g(H_RETURN) == SHOP) {
    if (curAlive) {
      s(H_PHASE, SHOP);
    } else {
      endTurn();
    }
    return;
  }
  if (!curAlive) s(H_CUR, nextAlive(cur));
  s(H_PHASE, ROLL);
}

function allSubmitted(): bool {
  const n = g(H_N);
  for (let i = 0; i < n; i++) {
    if (g(P(i, F_ALIVE)) == 1 && g(P(i, F_MGDONE)) == 0) return false;
  }
  return true;
}

// a ranks above b when its score is higher; ties break on a seeded hash so the
// result is identical on every machine
function better(a: i32, b: i32): bool {
  const sa = g(P(a, F_MGSCORE));
  const sb = g(P(b, F_MGSCORE));
  if (sa != sb) return sa > sb;
  const seed = g(H_MGSEED);
  return mix(seed, a) > mix(seed, b);
}

function resolveMinigame(): void {
  const n = g(H_N);
  let winner = -1;
  let loser = -1;
  for (let i = 0; i < n; i++) {
    if (g(P(i, F_ALIVE)) != 1) continue;
    if (winner < 0 || better(i, winner)) winner = i;
    if (loser < 0 || better(loser, i)) loser = i;
  }
  for (let i = 0; i < n; i++) {
    if (g(P(i, F_ALIVE)) != 1) continue;
    let rank = 1;
    for (let j = 0; j < n; j++) {
      if (j != i && g(P(j, F_ALIVE)) == 1 && better(j, i)) rank++;
    }
    s(P(i, F_MGRANK), rank);
  }
  s(P(winner, F_COINS), g(P(winner, F_COINS)) + MG_WIN_BONUS);
  s(H_MGWINNER, winner);
  s(H_TARGET, loser);
  s(H_STRIPPER, -1);
  s(H_RETURN, ROLL);
  s(H_PHASE, STRIP);
}

// ---------------------------------------------------------------- actions ---
// Every action returns >= 0 on success or a negative error code:
// -1 wrong phase, -2 not your turn / not allowed, -3 bad argument,
// -4 cannot afford / nothing to do.

/** femaleMask: bit i set means player i is a woman. */
export function initGame(n: i32, seed: i32, femaleMask: i32): i32 {
  if (n < 2 || n > MAX_PLAYERS) return -3;
  for (let i = 0; i < SIZE; i++) s(i, 0);
  s(H_N, n);
  s(H_RNG, seed == 0 ? 0x1badb002 : seed);
  s(H_WINNER, -1);
  s(H_STRIPPER, -1);
  s(H_MGWINNER, -1);
  s(H_TARGET, -1);
  s(H_PHASE, ROLL);
  s(H_CUR, 0);
  for (let i = 0; i < n; i++) {
    const gender = (femaleMask >> i) & 1;
    s(P(i, F_ALIVE), 1);
    s(P(i, F_GENDER), gender);
    s(P(i, F_COINS), 5);
    let total = 0;
    for (let k = 0; k < ITEM_KINDS; k++) {
      const c = startCount(k, gender);
      s(P(i, F_ITEMS + k), c);
      total += c;
    }
    s(P(i, F_TOTAL), total);
  }
  return 0;
}

export function actRoll(p: i32): i32 {
  if (g(H_PHASE) != ROLL) return -1;
  if (p != g(H_CUR)) return -2;
  const roll = 1 + <i32>(nextRand() % 6);
  s(H_ROLL, roll);
  const pos = (g(P(p, F_POS)) + roll) % BOARD;
  s(P(p, F_POS), pos);
  const t = spaceType(pos);
  s(H_LASTSPACE, t);
  let delta = 0;
  const coins = g(P(p, F_COINS));
  if (t == 0) delta = BLUE_COINS;
  else if (t == 1) delta = -min<i32>(RED_COINS, coins);
  s(P(p, F_COINS), coins + delta);
  s(H_LASTDELTA, delta);
  if (t == 2) s(H_PHASE, SHOP);
  else endTurn();
  return roll;
}

/** Tailor shop: put one item you previously lost back on. */
export function actShopBuy(p: i32, item: i32): i32 {
  if (g(H_PHASE) != SHOP) return -1;
  if (p != g(H_CUR)) return -2;
  if (item < 0 || item >= ITEM_KINDS) return -3;
  const gender = g(P(p, F_GENDER));
  if (g(P(p, F_ITEMS + item)) >= startCount(item, gender)) return -3;
  if (g(P(p, F_COINS)) < RESTORE_COST) return -4;
  s(P(p, F_COINS), g(P(p, F_COINS)) - RESTORE_COST);
  s(P(p, F_ITEMS + item), g(P(p, F_ITEMS + item)) + 1);
  s(P(p, F_TOTAL), g(P(p, F_TOTAL)) + 1);
  return 0;
}

/** Tailor shop: pay to make an opponent remove an item of their choice. */
export function actShopForce(p: i32, target: i32): i32 {
  if (g(H_PHASE) != SHOP) return -1;
  if (p != g(H_CUR)) return -2;
  if (!isPlayer(target) || target == p) return -3;
  if (g(P(target, F_ALIVE)) != 1) return -3;
  if (g(P(p, F_COINS)) < FORCE_COST) return -4;
  s(P(p, F_COINS), g(P(p, F_COINS)) - FORCE_COST);
  s(H_TARGET, target);
  s(H_STRIPPER, p);
  s(H_RETURN, SHOP);
  s(H_PHASE, STRIP);
  return 0;
}

export function actShopLeave(p: i32): i32 {
  if (g(H_PHASE) != SHOP) return -1;
  if (p != g(H_CUR)) return -2;
  endTurn();
  return 0;
}

/** Submit a raw minigame result (taps or milliseconds). */
export function actSubmit(p: i32, raw: i32): i32 {
  if (g(H_PHASE) != MINI) return -1;
  if (!isPlayer(p) || g(P(p, F_ALIVE)) != 1) return -2;
  if (g(P(p, F_MGDONE)) == 1) return -2;
  s(P(p, F_MGRAW), raw);
  s(P(p, F_MGSCORE), mgScore(g(H_MGTYPE), raw, g(H_MGSEED)));
  s(P(p, F_MGDONE), 1);
  if (allSubmitted()) resolveMinigame();
  return 0;
}

/** The chosen player removes one item. Hitting zero items eliminates them. */
export function actStrip(p: i32, item: i32): i32 {
  if (g(H_PHASE) != STRIP) return -1;
  if (p != g(H_TARGET)) return -2;
  if (item < 0 || item >= ITEM_KINDS) return -3;
  if (g(P(p, F_ITEMS + item)) <= 0) return -4;
  s(P(p, F_ITEMS + item), g(P(p, F_ITEMS + item)) - 1);
  const total = g(P(p, F_TOTAL)) - 1;
  s(P(p, F_TOTAL), total);
  if (total <= 0) s(P(p, F_ALIVE), 0);
  afterStrip();
  return 0;
}

/** Tap out. Always allowed, ends that player's game immediately. */
export function actForfeit(p: i32): i32 {
  const ph = g(H_PHASE);
  if (ph == LOBBY || ph == OVER) return -1;
  if (!isPlayer(p) || g(P(p, F_ALIVE)) != 1) return -2;
  for (let k = 0; k < ITEM_KINDS; k++) s(P(p, F_ITEMS + k), 0);
  s(P(p, F_TOTAL), 0);
  s(P(p, F_ALIVE), 0);
  if (checkOver()) return 0;
  if (ph == ROLL || ph == SHOP) {
    if (p == g(H_CUR)) endTurn();
  } else if (ph == MINI) {
    s(P(p, F_MGDONE), 1);
    if (allSubmitted()) resolveMinigame();
  } else if (ph == STRIP) {
    if (p == g(H_TARGET)) afterStrip();
  }
  return 0;
}
