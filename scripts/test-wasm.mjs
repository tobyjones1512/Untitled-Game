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
  assert.equal(run(s, () => ex.actStrip((loser + 1) % 3, 0)).code, -2); // only loser may strip
  const r = run(s, () => ex.actStrip(loser, 0));
  assert.equal(r.code, 0);
  assert.equal(r.s[P(loser, 10)], 6);
  assert.equal(r.s[0], ROLL);
});

t("cannot strip an item you don't own (no bra for men)", () => {
  let s = playToMinigame(run(new Array(80).fill(0), () => ex.initGame(2, 5, 0)).s);
  s = run(s, () => ex.actSubmit(0, 0)).s;
  s = run(s, () => ex.actSubmit(1, 0)).s;
  assert.equal(run(s, () => ex.actStrip(s[5], 5)).code, -4);
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
  const done = run(f.s, () => ex.actStrip(2, 3));
  assert.equal(done.s[0], SHOP);
  assert.equal(done.s[P(2, 4 + 3)], 1);
});

t("zero items eliminates, last player standing wins", () => {
  const init = run(new Array(80).fill(0), () => ex.initGame(2, 1, 0)).s;
  const s = [...init]; s[0] = STRIP; s[5] = 1; s[10] = ROLL; s[11] = -1;
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

console.log(`\n${tests} tests passed`);
