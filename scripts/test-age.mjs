// Drives the age-verification flow against a running app + scripts/mock-stripe.mjs.
//   BASE=http://localhost:3000 KEYKIND=test node scripts/test-age.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEYKIND = process.env.KEYKIND ?? "test"; // which key the app under test was started with
const MOCK = "http://localhost:4010";
const RATELIMIT_ONLY = process.env.RATELIMIT === "1"; // run against an app started with the default limit (5)

class Browser {
  jar = {};
  async fetch(path, init = {}) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + path, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), cookie } });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c) || v === "") delete this.jar[k]; else this.jar[k] = v;
    }
    return res;
  }
  async json(path, init) { const r = await this.fetch(path, init); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  async callback() { const r = await this.fetch("/api/age/callback"); return new URL(r.headers.get("location"), BASE).searchParams.get("verify"); }
  async start() { const r = await this.json("/api/age/start", { method: "POST" }); return r; }
}
const mock = (id, body) => fetch(`${MOCK}/__set/${id}`, { method: "POST", body: JSON.stringify(body) });
const yearsAgo = (y, extraDays = 0) => { const d = new Date(Date.now() - (y * 365.25 + extraDays) * 864e5); return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }; };
const joinBody = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Tester", gender: "man", consent: true }) };

let n = 0;
if (RATELIMIT_ONLY) {
  const b = new Browser();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await b.start()).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  console.log("ok - verification starts are rate limited to 5 per 10 minutes per IP");
  process.exit(0);
}
const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

await t("matchmaking is on, and nobody is verified by default", async () => {
  const b = new Browser();
  const c = (await b.json("/api/match/config")).body;
  assert.equal(c.enabled, true);
  assert.equal(c.verified, false);
  assert.equal((await b.json("/api/match/join", joinBody)).status, 403);
});

await t("start creates a Stripe session that requires ID + matching live selfie", async () => {
  const b = new Browser();
  const r = await b.start();
  assert.equal(r.status, 200);
  assert.match(r.body.url, /hosted\/vs_mock/);
  assert.ok(b.jar.idv_s && b.jar.idv_n);
  const s = await (await fetch(`${MOCK}/v1/identity/verification_sessions/${b.jar.idv_s}`, { headers: { authorization: "Bearer sk_x" } })).json();
  assert.equal(s.type, "document");
  assert.equal(s.options.document.require_matching_selfie, true);
  assert.equal(s.options.document.require_live_capture, true);
  assert.equal(s.metadata.nonce, b.jar.idv_n);
});

await t("returning without finishing the check does NOT pass", async () => {
  const b = new Browser(); await b.start();
  assert.equal(await b.callback(), "failed");
  assert.equal((await b.json("/api/match/join", joinBody)).status, 403);
});

await t("still processing shows 'pending' and can be checked again", async () => {
  const b = new Browser(); await b.start();
  await mock(b.jar.idv_s, { status: "processing" });
  assert.equal(await b.callback(), "pending");
  await mock(b.jar.idv_s, { status: "verified", dob: yearsAgo(30) });
  assert.equal(await b.callback(), "ok");
});

await t("a verified adult gets a pass and can join the queue", async () => {
  const b = new Browser(); await b.start();
  await mock(b.jar.idv_s, { status: "verified", dob: yearsAgo(30) });
  assert.equal(await b.callback(), "ok");
  assert.ok(b.jar.adult_v);
  assert.equal((await b.json("/api/match/config")).body.verified, true);
  const j = await b.json("/api/match/join", joinBody);
  assert.equal(j.status, 200);
  assert.ok(j.body.ticket);
  await b.json("/api/match/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: j.body.ticket }) });
});

await t("a verified MINOR is refused", async () => {
  const b = new Browser(); await b.start();
  await mock(b.jar.idv_s, { status: "verified", dob: yearsAgo(16) });
  assert.equal(await b.callback(), "minor");
  assert.ok(!b.jar.adult_v);
});

await t("turns 18 today passes, one day short fails", async () => {
  const pass = new Browser(); await pass.start();
  await mock(pass.jar.idv_s, { status: "verified", dob: yearsAgo(18, 2) });
  assert.equal(await pass.callback(), "ok");
  const fail = new Browser(); await fail.start();
  await mock(fail.jar.idv_s, { status: "verified", dob: yearsAgo(18, -3) });
  assert.equal(await fail.callback(), "minor");
});

await t("one verified check can only be redeemed once (no sharing)", async () => {
  const a = new Browser(); await a.start();
  await mock(a.jar.idv_s, { status: "verified", dob: yearsAgo(40) });
  const copy = new Browser(); copy.jar = { ...a.jar };
  assert.equal(await a.callback(), "ok");
  assert.equal(await copy.callback(), "failed");
  assert.ok(!copy.jar.adult_v);
});

await t("a result from someone else's session (wrong nonce) is rejected", async () => {
  const victim = new Browser(); await victim.start();
  await mock(victim.jar.idv_s, { status: "verified", dob: yearsAgo(40) });
  const attacker = new Browser(); await attacker.start();
  attacker.jar.idv_s = victim.jar.idv_s; // try to borrow the adult's session
  assert.equal(await attacker.callback(), "expired");
  assert.ok(!attacker.jar.adult_v);
});

await t("no cookies = expired; forged pass cookies are worthless", async () => {
  const b = new Browser();
  assert.equal(await b.callback(), "expired");
  b.jar.adult_v = `${Date.now() + 1e9}.${"0".repeat(64)}`;
  assert.equal((await b.json("/api/match/join", joinBody)).status, 403);
  b.jar.adult_v = `1.abc`;
  assert.equal((await b.json("/api/match/join", joinBody)).status, 403);
});

if (KEYKIND === "live") {
  await t("LIVE key: a verified session with no date of birth is refused", async () => {
    const b = new Browser(); await b.start();
    await mock(b.jar.idv_s, { status: "verified" });
    assert.equal(await b.callback(), "failed");
  });
} else {
  await t("TEST key: sample documents with no DOB are accepted (Stripe test mode)", async () => {
    const b = new Browser(); await b.start();
    await mock(b.jar.idv_s, { status: "verified" });
    assert.equal(await b.callback(), "ok");
  });
}

console.log(`\n${n} checks passed (${KEYKIND} key)`);
