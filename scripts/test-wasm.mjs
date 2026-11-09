// Rules tests that run against the compiled public/wasm/game.wasm.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { rollDie, pickUnique, entropy } from "../src/lib/server/dice.ts";

const { instance } = await WebAssembly.instantiate(readFileSync(new URL("../public/wasm/game.wasm", import.meta.url)), {});
const ex = instance.exports;
const SIZE = ex.stateSize();
const view = () => new Int32Array(ex.memory.buffer, ex.statePtr(), SIZE);
const S = () => Array.from(view());
const STRIDE = 20;
const P = (p, f) => 16 + p * STRIDE + f;
const ITEM_OFF = (p, i) => P(p, 4 + i);
const [LOBBY, ROLL, SHOP, MINI, STRIP, OVER, ORDER] = [0, 1, 2, 3, 4, 5, 6];

function run(state, fn) { view().set(state); const code = fn(); return { code, s: S() }; }
let tests = 0;
const t = (name, fn) => { fn(); tests++; console.log("ok -", name); };

// start a game and resolve the turn-order roll-off so player 0 goes first, then 1, 2, 3
function begin(n, seed, mask) {
  const init = run(new Array(SIZE).fill(0), () => ex.initGame(n, seed, mask));
  if (init.code < 0) return init;
  let s = init.s;
  for (let p = 0; p < n; p++) s = run(s, () => ex.actOrderRoll(p, 6 - p)).s;
  return { code: 0, s };
}

// everyone except the target votes for `item`; returns state with the vote resolved
function voteAll(s, item) {
  const target = s[5];
  for (let v = 0; v < s[1]; v++) {
    if (v === target || s[P(v, 0)] !== 1) continue;
    s = run(s, () => ex.actVote(v, item)).s;
  }
  return s;
}
const roll = (s, p, face = 3) => run(s, () => ex.actRoll(p, face, 12345));

t("every player starts with exactly 7 items", () => {
  const { s } = begin(4, 42, 0b0110);
  for (let p = 0; p < 4; p++) assert.equal(s[P(p, 10)], 7);
  assert.deepEqual(s.slice(P(0, 4), P(0, 10)), [1, 1, 1, 2, 2, 0]); // man: 2 socks, no bra
  assert.deepEqual(s.slice(P(1, 4), P(1, 10)), [1, 1, 1, 2, 1, 1]); // woman: 1 sock + bra
});

t("rejects bad player counts", () => {
  assert.equal(begin(1, 1, 0).code, -3);
  assert.equal(begin(5, 1, 0).code, -3);
});

t("a new game starts in the turn-order roll-off", () => {
  assert.equal(run(new Array(SIZE).fill(0), () => ex.initGame(3, 9, 0)).s[0], ORDER);
});

t("turn order: highest roll goes first, rolls must be unique, everyone must roll", () => {
  let s = run(new Array(SIZE).fill(0), () => ex.initGame(3, 9, 0)).s;
  s = run(s, () => ex.actOrderRoll(0, 2)).s;
  assert.equal(run(s, () => ex.actOrderRoll(0, 5)).code, -2); // only one roll each
  assert.equal(run(s, () => ex.actOrderRoll(1, 2)).code, -3); // no duplicate numbers
  assert.equal(run(s, () => ex.actOrderRoll(1, 7)).code, -3); // d6 only
  s = run(s, () => ex.actOrderRoll(1, 6)).s;
  assert.equal(s[0], ORDER); // still waiting on player 2
  s = run(s, () => ex.actOrderRoll(2, 4)).s;
  assert.equal(s[0], ROLL);
  assert.equal(s[2], 1); // player 1 rolled 6 and goes first
  assert.deepEqual([0, 1, 2].map((p) => s[P(p, 17)]), [2, 0, 1]); // seats
  // play follows seat order: 1 -> 2 -> 0, then the lap ends in a minigame
  s = roll(s, 1).s; assert.equal(s[2], 2);
  s = roll(s, 2).s; assert.equal(s[2], 0);
  s = roll(s, 0).s;
  assert.equal(s[0], MINI);
  assert.equal(s[2], 1); // next lap starts with the same first player
});

t("turn order survives a player tapping out during the roll-off", () => {
  let s = run(new Array(SIZE).fill(0), () => ex.initGame(3, 9, 0)).s;
  s = run(s, () => ex.actOrderRoll(0, 6)).s; // would have gone first...
  s = run(s, () => ex.actForfeit(0)).s;      // ...but quits
  s = run(s, () => ex.actOrderRoll(1, 2)).s;
  s = run(s, () => ex.actOrderRoll(2, 5)).s;
  assert.equal(s[0], ROLL);
  assert.equal(s[2], 2); // highest living roller
});

t("dice are host-supplied and must be 1-6", () => {
  const { s } = begin(2, 7, 0);
  assert.equal(roll(s, 1).code, -2); // turn-gated
  assert.equal(run(s, () => ex.actRoll(0, 0, 1)).code, -3);
  assert.equal(run(s, () => ex.actRoll(0, 7, 1)).code, -3);
  const a = roll(s, 0, 4), b = roll(s, 0, 4);
  assert.deepEqual(a.s, b.s); // engine itself stays deterministic given the same inputs
  assert.equal(a.code, 4);
});

t("server dice are fair (chi-square over 60k rolls) and unique picks never tie", () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 60000; i++) counts[rollDie()]++;
  const exp = 10000;
  const chi = counts.slice(1).reduce((a, c) => a + (c - exp) ** 2 / exp, 0);
  assert.ok(chi < 20.5, `chi-square ${chi.toFixed(1)} too high`); // df=5, p=0.001
  for (let i = 0; i < 2000; i++) {
    const taken = [];
    for (let k = 0; k < 4; k++) taken.push(pickUnique(taken));
    assert.equal(new Set(taken).size, 4);
  }
  assert.notEqual(entropy(), entropy());
});

t("board has blue, red, shop and start spaces", () => {
  const types = new Set(Array.from({ length: ex.boardSize() }, (_, i) => ex.spaceType(i)));
  assert.deepEqual([...types].sort(), [0, 1, 2, 3]);
});

function playToMinigame(state) {
  let s = state, guard = 0;
  while (s[0] !== MINI && guard++ < 500) {
    if (s[0] === ROLL) s = roll(s, s[2], 1 + (guard % 6)).s;
    else if (s[0] === SHOP) s = run(s, () => ex.actShopLeave(s[2])).s;
    else throw new Error("unexpected phase " + s[0]);
  }
  assert.equal(s[0], MINI);
  return s;
}

t("a full board cycle launches a minigame", () => {
  const s = playToMinigame(begin(3, 99, 0).s);
  assert.equal(s[3], 1);
});

t("minigame types vary and never repeat back to back", () => {
  let s = begin(2, 31, 0).s, prev = -1;
  const seen = new Set();
  for (let r = 0; r < 12; r++) {
    s = playToMinigame(s);
    assert.notEqual(s[8], prev);
    prev = s[8]; seen.add(prev);
    s = run(s, () => ex.actSubmit(0, 10)).s;
    s = run(s, () => ex.actSubmit(1, 20)).s;
    s = voteAll(s, 0);
    const loser = s[5];
    // keep both players alive: restore a shirt each time via direct state edit
    s = run(s, () => ex.actStrip(loser, s[15])).s;
    s[P(loser, 4)] = 1; s[P(loser, 10)] = 7; s[P(loser, 0)] = 1;
  }
  assert.ok(seen.size >= 4, `only saw ${[...seen]}`);
});

t("last place in the minigame must strip, and loses exactly one item", () => {
  let s = playToMinigame(begin(3, 5, 0).s);
  const type = s[8];
  s = run(s, () => ex.actSubmit(0, 40)).s;
  s = run(s, () => ex.actSubmit(1, 10)).s;
  assert.equal(s[0], MINI);
  s = run(s, () => ex.actSubmit(2, 55)).s;
  assert.equal(s[0], STRIP);
  const loser = s[5];
  assert.equal(run(s, () => ex.actStrip(loser, 0)).code, -4); // can't strip before the vote closes
  assert.equal(run(s, () => ex.actVote(loser, 0)).code, -2);  // the loser can't vote on themselves
  s = voteAll(s, 0);
  assert.equal(s[15], 0); // vote picked the shirt
  assert.equal(run(s, () => ex.actStrip((loser + 1) % 3, 0)).code, -2); // only loser may strip
  assert.equal(run(s, () => ex.actStrip(loser, 3)).code, -3); // must be the voted item
  const r = run(s, () => ex.actStrip(loser, 0));
  assert.equal(r.code, 0);
  assert.equal(r.s[P(loser, 10)], 6);
  assert.equal(r.s[0], ROLL);
});

t("cannot vote for an item that isn't there (no bra for men)", () => {
  let s = playToMinigame(begin(2, 5, 0).s);
  s = run(s, () => ex.actSubmit(0, 0)).s;
  s = run(s, () => ex.actSubmit(1, 0)).s;
  assert.equal(run(s, () => ex.actVote(1 - s[5], 5)).code, -5);
});

t("tailor shop: restore an item costs coins and obeys the starting cap", () => {
  const init = begin(2, 1, 0).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 10; shop[ITEM_OFF(0, 1)] = 0; shop[P(0, 10)] = 6;
  const ok = run(shop, () => ex.actShopBuy(0, 1));
  assert.equal(ok.code, 0);
  assert.equal(ok.s[P(0, 1)], 5);
  assert.equal(ok.s[P(0, 10)], 7);
  assert.equal(run(ok.s, () => ex.actShopBuy(0, 1)).code, -3); // already at cap
  const broke = [...shop]; broke[P(0, 1)] = 4;
  assert.equal(run(broke, () => ex.actShopBuy(0, 1)).code, -4);
});

t("tailor shop: forcing a strip costs coins and returns to the shop", () => {
  const init = begin(3, 1, 0).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 8;
  assert.equal(run(shop, () => ex.actShopForce(0, 0)).code, -3); // not yourself
  const f = run(shop, () => ex.actShopForce(0, 2));
  assert.equal(f.code, 0);
  assert.equal(f.s[0], STRIP);
  assert.equal(f.s[P(0, 1)], 0);
  const voted = voteAll(f.s, 3);
  const done = run(voted, () => ex.actStrip(2, 3));
  assert.equal(done.s[0], SHOP);
  assert.equal(done.s[ITEM_OFF(2, 3)], 1);
});

t("zero items eliminates, last player standing wins", () => {
  const init = begin(2, 1, 0).s;
  const s = [...init]; s[0] = STRIP; s[5] = 1; s[10] = ROLL; s[11] = -1; s[15] = 0;
  for (let k = 0; k < 6; k++) s[P(1, 4 + k)] = 0;
  s[P(1, 4)] = 1; s[P(1, 10)] = 1;
  const r = run(s, () => ex.actStrip(1, 0));
  assert.equal(r.s[P(1, 0)], 0);
  assert.equal(r.s[0], OVER);
  assert.equal(r.s[6], 0);
});

t("tapping out (forfeit) ends the game for them from any phase", () => {
  const init = begin(3, 3, 0).s;
  let r = run(init, () => ex.actForfeit(0)); // current player quits mid-turn
  assert.equal(r.s[P(0, 0)], 0);
  assert.equal(r.s[2], 1);
  assert.equal(r.s[0], ROLL);
  r = run(r.s, () => ex.actForfeit(1));
  assert.equal(r.s[0], OVER);
  assert.equal(r.s[6], 2);
});

t("minigame scoring: caps, plausibility checks, and ordering for all 6 games", () => {
  assert.equal(ex.mgScore(0, 1000, 0), 60000);               // mash capped
  assert.equal(ex.mgScore(0, -5, 0), 0);
  const target = ex.mgTarget(1234);
  assert.ok(target >= 3000 && target < 7000);
  assert.equal(ex.mgScore(1, target, 1234), 10000);          // clock
  assert.ok(ex.mgScore(1, target + 500, 1234) < ex.mgScore(1, target + 100, 1234));
  assert.equal(ex.mgScore(1, 999999, 1234), 0);
  assert.ok(ex.mgScore(2, 180, 1) > ex.mgScore(2, 350, 1));  // reaction: faster is better
  assert.equal(ex.mgScore(2, 20, 1), 0);                     // faster than human = rejected
  assert.equal(ex.mgScore(2, -1, 1), 0);                     // false start
  assert.ok(ex.mgScore(3, 8, 1) > ex.mgScore(3, 5, 1));      // memory
  assert.equal(ex.mgScore(3, 500, 1), 12000);
  assert.ok(ex.mgScore(4, 12, 1) > ex.mgScore(4, 9, 1));     // maths
  assert.ok(ex.mgScore(5, 6000, 1) > ex.mgScore(5, 9000, 1)); // targets: faster is better
  assert.equal(ex.mgScore(5, 300, 1), 0);                    // impossible speed
  assert.equal(ex.mgScore(5, -1, 1), 0);                     // did not finish
});

t("minigame content is deterministic from the seed", () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(ex.mgCell(777, i), ex.mgCell(777, i));
    if (i) assert.notEqual(ex.mgCell(777, i), ex.mgCell(777, i - 1)); // target always moves
    assert.ok(ex.mgCell(777, i) >= 0 && ex.mgCell(777, i) < 9);
  }
  const d = ex.mgReactionDelay(42);
  assert.ok(d >= 1500 && d < 4000);
  const r = Array.from({ length: 200 }, (_, i) => ex.mgRand(5, i, 4));
  assert.ok(r.every((v) => v >= 0 && v < 4) && new Set(r).size === 4);
});

t("clothes come off in a sensible order", () => {
  const woman = begin(2, 1, 0b01).s; // player 0 = woman
  const can = (st, item) => run(st, () => ex.canRemove(0, item)).code === 1;
  // fully dressed: only shirt and shoes can go first (pants can't come off over shoes)
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => can(woman, i)), [true, false, false, true, false, false]);
  const oneShoe = [...woman]; oneShoe[ITEM_OFF(0, 3)] = 1;
  assert.equal(can(oneShoe, 1), false); // still a shoe on
  assert.equal(can(oneShoe, 4), false);
  const noShoes = [...woman]; noShoes[ITEM_OFF(0, 3)] = 0;
  assert.equal(can(noShoes, 1), true);  // pants OK once shoes are off
  assert.equal(can(noShoes, 4), true);  // socks too
  // bra needs shirt, pants, shoes and socks off
  const bare = [...woman]; [0, 1, 3, 4].forEach((i) => (bare[ITEM_OFF(0, i)] = 0));
  assert.equal(can(bare, 5), true);
  assert.equal(can(bare, 2), false); // underwear still waits for the bra
  bare[ITEM_OFF(0, 5)] = 0;
  assert.equal(can(bare, 2), true);  // ...and goes last
});

t("EVERY reachable wardrobe state has a legal item to remove (no dead ends)", () => {
  for (const mask of [0b00, 0b11]) {
    const init = begin(2, 1, mask).s;
    const key = (st) => st.slice(ITEM_OFF(0, 0), ITEM_OFF(0, 6)).join(",");
    const seen = new Set([key(init)]);
    const queue = [init];
    let states = 0;
    while (queue.length) {
      const st = queue.pop();
      states++;
      const left = st.slice(ITEM_OFF(0, 0), ITEM_OFF(0, 6)).reduce((a, b) => a + b, 0);
      if (left === 0) continue;
      const legal = [0, 1, 2, 3, 4, 5].filter((i) => run(st, () => ex.canRemove(0, i)).code === 1);
      assert.ok(legal.length > 0, `dead end at ${key(st)}`);
      for (const i of legal) {
        const nx = [...st]; nx[ITEM_OFF(0, i)] -= 1;
        if (!seen.has(key(nx))) { seen.add(key(nx)); queue.push(nx); }
      }
    }
    assert.ok(states > 10);
  }
});

t("tailor shop only restores items in a legal order", () => {
  const init = begin(2, 1, 0).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 99;
  shop[ITEM_OFF(0, 3)] = 0; shop[ITEM_OFF(0, 4)] = 0; shop[P(0, 10)] = 3; // shoes + socks off
  assert.equal(run(shop, () => ex.actShopBuy(0, 3)).code, -5); // shoes can't come back before socks
  assert.equal(run(shop, () => ex.actShopBuy(0, 4)).code, 0);
  const pantsOff = [...init]; pantsOff[0] = SHOP; pantsOff[P(0, 1)] = 99;
  pantsOff[ITEM_OFF(0, 1)] = 0; pantsOff[ITEM_OFF(0, 3)] = 0; pantsOff[P(0, 10)] = 4;
  assert.equal(run(pantsOff, () => ex.actShopBuy(0, 3)).code, -5); // shoes can't go on before pants
  assert.equal(run(pantsOff, () => ex.actShopBuy(0, 1)).code, 0);
});

t("voting: plurality wins, a lone vote is final, forfeiting voters don't stall it", () => {
  const init = begin(4, 3, 0).s;
  const strip = [...init]; strip[0] = STRIP; strip[5] = 3; strip[10] = ROLL; strip[11] = -1; strip[15] = -1;
  assert.equal(run(strip, () => ex.actVote(0, 1)).code, -5); // pants aren't legal while shoes are on
  let s = run(strip, () => ex.actVote(0, 0)).s;
  assert.equal(s[15], -1); // still waiting on 1 and 2
  s = run(s, () => ex.actVote(1, 3)).s;
  s = run(s, () => ex.actVote(2, 3)).s;
  assert.equal(s[15], 3); // shoes win 2 to 1
  assert.equal(run(s, () => ex.actVote(0, 0)).code, -1); // voting is closed
  let r = run(strip, () => ex.actVote(0, 3)).s; r = run(r, () => ex.actVote(0, 0)).s;
  assert.equal(r[P(0, 15)], 1); // votes can be changed
  let f = run(strip, () => ex.actVote(0, 0)).s; f = run(f, () => ex.actVote(1, 0)).s;
  f = run(f, () => ex.actForfeit(2)).s;
  assert.equal(f[15], 0);
  const c = run(strip, () => ex.actVoteClose());
  assert.ok(c.s[15] >= 0 && run(c.s, () => ex.canRemove(3, c.s[15])).code === 1);
});

console.log(`\n${tests} tests passed`);
