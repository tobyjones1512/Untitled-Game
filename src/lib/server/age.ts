// Age gate for "play with strangers".
//
// Players verify with Stripe Identity (government photo ID + live selfie match), which
// runs on Stripe's hosted page. Our server never sees the photos or the ID. After Stripe
// redirects the player back, /api/age/callback fetches the session from Stripe with our
// secret key, checks it is `verified` and that the verified date of birth is 18+, then
// hands this browser a signed pass/fail cookie. Nothing else is stored.
//
// Turn it on by setting ONE environment variable: STRIPE_SECRET_KEY (sk_test_... to try
// it with Stripe's test mode, sk_live_... for real checks). Unset it and matchmaking
// disappears. Optional: AGE_COOKIE_SECRET (otherwise derived from the Stripe key),
// STRANGERS_DISABLED=1 (kill switch).
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADULT_COOKIE = "adult_v";
const MAX_AGE_S = 30 * 24 * 60 * 60;

export function stripeKey(): string {
  return process.env.STRIPE_SECRET_KEY ?? "";
}

export function stripeConfigured(): boolean {
  return /^(sk|rk)_(test|live)_/.test(stripeKey());
}

/** Local development only: skips Stripe. Refused on Vercel production. */
export function devProviderAllowed(): boolean {
  return process.env.AGE_VERIFICATION_PROVIDER === "dev" && process.env.VERCEL_ENV !== "production";
}

export function strangersEnabled(): boolean {
  if (process.env.STRANGERS_DISABLED === "1") return false;
  return stripeConfigured() || devProviderAllowed();
}

function secret(): string {
  if (process.env.AGE_COOKIE_SECRET) return process.env.AGE_COOKIE_SECRET;
  if (stripeConfigured()) return createHmac("sha256", stripeKey()).update("last-thread-adult-cookie-v1").digest("hex");
  return devProviderAllowed() ? "dev-only-secret" : "";
}

function sign(exp: number): string {
  return createHmac("sha256", secret()).update(`adult:${exp}`).digest("hex");
}

export function mintAdultCookie(): { name: string; value: string; maxAge: number } {
  if (!secret()) throw new Error("Age verification is not configured.");
  const exp = Date.now() + MAX_AGE_S * 1000;
  return { name: ADULT_COOKIE, value: `${exp}.${sign(exp)}`, maxAge: MAX_AGE_S };
}

export function isAdult(req: Request): boolean {
  if (!secret()) return false;
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${ADULT_COOKIE}=`));
  if (!m) return false;
  const [expStr, sig] = m.slice(ADULT_COOKIE.length + 1).split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function readCookie(req: Request, name: string): string {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}
