// Rules tests that run against the compiled public/wasm/game.wasm.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const { instance } = await WebAssembly.instantiate(readFileSync(new URL("../public/wasm/game.wasm", import.meta.url)), {});
const ex = instance.exports;
const view = () => new Int32Array(ex.memory.buffer, ex.statePtr(), ex.stateSize());
const S = () => Array.from(view());
const P = (p, f) => 16 + p * 16 + f;
const [LOBBY, ROLL, SHOP, MINI, STRIP, OVER] = [0, 1, 2, 3, 4, 5];

function run(state, fn) { view().set(state); const code = fn(); return { code, s: S() }; }
let tests = 0;
const ITEM_OFF = (p, i) => 16 + p * 16 + 4 + i;
// everyone except the target votes for `item`; returns state with the vote resolved
function voteAll(s, item) {
  const target = s[5];
  for (let v = 0; v < s[1]; v++) {
    if (v === target || s[16 + v * 16] !== 1) continue;
    s = run(s, () => ex.actVote(v, item)).s;
  }
  return s;
}
const t = (name, fn) => { fn(); tests++; console.log("ok -", name); };

t("every player starts with exactly 7 items", () => {
  const { s } = run(new Array(80).fill(0), () => ex.initGame(4, 42, 0b0110));
  for (let p = 0; p < 4; p++) assert.equal(s[P(p, 10)], 7);
  assert.deepEqual(s.slice(P(0, 4), P(0, 10)), [1, 1, 1, 2, 2, 0]); // man: 2 socks, no bra
  assert.deepEqual(s.slice(P(1, 4), P(1, 10)), [1, 1, 1, 2, 1, 1]); // woman: 1 sock + bra
});

t("rejects bad player counts", () => {
  assert.equal(run(new Array(80).fill(0), () => ex.initGame(1, 1, 0)).code, -3);
  assert.equal(run(new Array(80).fill(0), () => ex.initGame(5, 1, 0)).code, -3);
});

t("roll is deterministic and turn-gated", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(2, 7, 0)).s;
  assert.equal(run(init, () => ex.actRoll(1)).code, -2);
  const a = run(init, () => ex.actRoll(0)), b = run(init, () => ex.actRoll(0));
  assert.deepEqual(a.s, b.s);
  assert.ok(a.code >= 1 && a.code <= 6);
});

t("board has blue, red, shop and start spaces", () => {
  const types = new Set(Array.from({ length: ex.boardSize() }, (_, i) => ex.spaceType(i)));
  assert.deepEqual([...types].sort(), [0, 1, 2, 3]);
});

// drive a full cycle by rolling until the phase becomes MINI
function playToMinigame(state) {
  let s = state, guard = 0;
  while (s[0] !== MINI && guard++ < 500) {
    if (s[0] === ROLL) s = run(s, () => ex.actRoll(s[2])).s;
    else if (s[0] === SHOP) s = run(s, () => ex.actShopLeave(s[2])).s;
    else throw new Error("unexpected phase " + s[0]);
  }
  assert.equal(s[0], MINI);
  return s;
}

t("a full board cycle launches a minigame", () => {
  const s = playToMinigame(run(new Array(80).fill(0), () => ex.initGame(3, 99, 0)).s);
  assert.equal(s[3], 1); // round counter
});

t("last place in the minigame must strip, and loses exactly one item", () => {
  let s = playToMinigame(run(new Array(80).fill(0), () => ex.initGame(3, 5, 0)).s);
  s = run(s, () => ex.actSubmit(0, 40)).s;
  s = run(s, () => ex.actSubmit(1, 10)).s;
  assert.equal(s[0], MINI);
  s = run(s, () => ex.actSubmit(2, 55)).s;
  assert.equal(s[0], STRIP);
  if (s[8] === 0) {
    assert.equal(s[5], 1); // player 1 tapped least
    assert.equal(s[P(0, 11 + 1)] > s[P(1, 12)], true);
  }
  const loser = s[5];
  assert.equal(run(s, () => ex.actStrip(loser, 0)).code, -4); // can't strip before the vote closes
  assert.equal(run(s, () => ex.actVote(loser, 0)).code, -2); // the loser can't vote on themselves
  s = voteAll(s, 0);
  assert.equal(s[15], 0); // vote picked the shirt
  assert.equal(run(s, () => ex.actStrip((loser + 1) % 3, 0)).code, -2); // only loser may strip
  assert.equal(run(s, () => ex.actStrip(loser, 1)).code, -3); // must be the voted item
  const r = run(s, () => ex.actStrip(loser, 0));
  assert.equal(r.code, 0);
  assert.equal(r.s[P(loser, 10)], 6);
  assert.equal(r.s[0], ROLL);
});

t("cannot strip an item you don't own (no bra for men)", () => {
  let s = playToMinigame(run(new Array(80).fill(0), () => ex.initGame(2, 5, 0)).s);
  s = run(s, () => ex.actSubmit(0, 0)).s;
  s = run(s, () => ex.actSubmit(1, 0)).s;
  assert.equal(run(s, () => ex.actVote(1 - s[5], 5)).code, -5); // men have no bra to vote for
});

t("tailor shop: restore an item costs coins and obeys the starting cap", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0)).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 10; shop[P(0, 4 + 1)] = 0; shop[P(0, 10)] = 6;
  const ok = run(shop, () => ex.actShopBuy(0, 1));
  assert.equal(ok.code, 0);
  assert.equal(ok.s[P(0, 1)], 5);
  assert.equal(ok.s[P(0, 10)], 7);
  assert.equal(run(ok.s, () => ex.actShopBuy(0, 1)).code, -3); // already at cap
  const broke = [...shop]; broke[P(0, 1)] = 4;
  assert.equal(run(broke, () => ex.actShopBuy(0, 1)).code, -4);
});

t("tailor shop: forcing a strip costs coins and returns to the shop", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(3, 1, 0)).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 8;
  assert.equal(run(shop, () => ex.actShopForce(0, 0)).code, -3); // not yourself
  const f = run(shop, () => ex.actShopForce(0, 2));
  assert.equal(f.code, 0);
  assert.equal(f.s[0], STRIP);
  assert.equal(f.s[P(0, 1)], 0);
  const voted = voteAll(f.s, 3);
  const done = run(voted, () => ex.actStrip(2, 3));
  assert.equal(done.s[0], SHOP);
  assert.equal(done.s[P(2, 4 + 3)], 1);
});

t("zero items eliminates, last player standing wins", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0)).s;
  const s = [...init]; s[0] = STRIP; s[5] = 1; s[10] = ROLL; s[11] = -1; s[15] = 0;
  for (let k = 0; k < 6; k++) s[P(1, 4 + k)] = 0;
  s[P(1, 4)] = 1; s[P(1, 10)] = 1;
  const r = run(s, () => ex.actStrip(1, 0));
  assert.equal(r.s[P(1, 0)], 0);
  assert.equal(r.s[0], OVER);
  assert.equal(r.s[6], 0);
});

t("tapping out (forfeit) ends the game for them from any phase", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(3, 3, 0)).s;
  let r = run(init, () => ex.actForfeit(0)); // current player quits mid-turn
  assert.equal(r.s[P(0, 0)], 0);
  assert.equal(r.s[2], 1);
  assert.equal(r.s[0], ROLL);
  r = run(r.s, () => ex.actForfeit(1));
  assert.equal(r.s[0], OVER);
  assert.equal(r.s[6], 2);
});

t("minigame scoring is plausible-capped and distance-based", () => {
  assert.equal(ex.mgScore(0, 1000, 0), 60000);
  assert.equal(ex.mgScore(0, -5, 0), 0);
  const target = ex.mgTarget(1234);
  assert.ok(target >= 3000 && target < 7000);
  assert.equal(ex.mgScore(1, target, 1234), 10000);
  assert.ok(ex.mgScore(1, target + 500, 1234) < ex.mgScore(1, target + 100, 1234));
  assert.equal(ex.mgScore(1, 999999, 1234), 0);
});

t("clothes come off in a sensible order", () => {
  const woman = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0b01)).s; // player 0 = woman
  const can = (st, item) => run(st, () => ex.canRemove(0, item)).code === 1;
  // fully dressed: shirt, pants, shoes ok; socks, bra, underwear not
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => can(woman, i)), [true, true, false, true, false, false]);
  // shoes (2) must both go before socks
  let st = run(woman, () => ex.actStrip(0, 0)).s; // (not a legal call: wrong phase) leaves state untouched
  st = [...woman]; st[ITEM_OFF(0, 3)] = 1;
  assert.equal(can(st, 4), false);
  st[ITEM_OFF(0, 3)] = 0;
  assert.equal(can(st, 4), true);
  // bra needs shirt, pants, shoes and socks off
  const bare = [...woman]; [0, 1, 3, 4].forEach((i) => (bare[ITEM_OFF(0, i)] = 0));
  assert.equal(can(bare, 5), true);
  assert.equal(can(bare, 2), false); // underwear still waits for the bra
  bare[ITEM_OFF(0, 5)] = 0;
  assert.equal(can(bare, 2), true); // ...and goes last
  // a man's single remaining sock can't go while shoes are on
  const man = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0)).s;
  assert.equal(run(man, () => ex.canRemove(0, 4)).code, 0);
});

t("there is always at least one legal item to remove", () => {
  for (const mask of [0b00, 0b11]) {
    const init = run(new Array(80).fill(0), () => ex.initGame(2, 1, mask)).s;
    // walk a player all the way down, always taking the first legal item
    let st = [...init];
    for (let step = 0; step < 7; step++) {
      const legal = [0, 1, 2, 3, 4, 5].filter((i) => run(st, () => ex.canRemove(0, i)).code === 1);
      assert.ok(legal.length > 0, `no legal item at step ${step}`);
      st[ITEM_OFF(0, legal[legal.length - 1])] -= 1;
    }
    assert.equal(st.slice(ITEM_OFF(0, 0), ITEM_OFF(0, 6)).reduce((a, b) => a + b, 0), 0);
  }
});

t("tailor shop only restores items in a legal order", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0)).s;
  const shop = [...init]; shop[0] = SHOP; shop[P(0, 1)] = 99;
  // shoes and socks both off: shoes can't come back before socks
  shop[ITEM_OFF(0, 3)] = 0; shop[ITEM_OFF(0, 4)] = 0; shop[P(0, 10)] = 3;
  assert.equal(run(shop, () => ex.actShopBuy(0, 3)).code, -5);
  assert.equal(run(shop, () => ex.actShopBuy(0, 4)).code, 0);
});

t("voting: plurality wins, a lone vote is final, forfeiting voters don't stall it", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(4, 3, 0)).s;
  const strip = [...init]; strip[0] = STRIP; strip[5] = 3; strip[10] = ROLL; strip[11] = -1; strip[15] = -1;
  let s = run(strip, () => ex.actVote(0, 1)).s;
  assert.equal(s[15], -1); // still waiting on 1 and 2
  s = run(s, () => ex.actVote(1, 3)).s;
  s = run(s, () => ex.actVote(2, 3)).s;
  assert.equal(s[15], 3); // shoes win 2 to 1
  assert.equal(run(s, () => ex.actVote(0, 0)).code, -1); // voting is closed
  // vote can be changed before everyone has voted
  let r = run(strip, () => ex.actVote(0, 1)).s; r = run(r, () => ex.actVote(0, 0)).s;
  assert.equal(r[P(0, 15)], 1);
  // a voter tapping out lets the rest finish
  let f = run(strip, () => ex.actVote(0, 0)).s; f = run(f, () => ex.actVote(1, 0)).s;
  f = run(f, () => ex.actForfeit(2)).s;
  assert.equal(f[15], 0);
  // closing the vote with no votes still picks a legal item
  const c = run(strip, () => ex.actVoteClose());
  assert.ok(c.s[15] >= 0 && run(c.s, () => ex.canRemove(3, c.s[15])).code === 1);
});

console.log(`\n${tests} tests passed`);
