// Age-verification gate for the "play with strangers" feature.
//
// Self-declared checkboxes are NOT enough to match anonymous people into a game
// played on camera. Stranger matchmaking therefore stays OFF unless a verified-adult
// cookie can be issued, which needs a real provider you plug in:
//
//   STRANGERS_ENABLED=1
//   AGE_COOKIE_SECRET=<long random string>      signs the "verified adult" cookie
//   AGE_VERIFICATION_URL=<provider start URL>   where players are sent to verify
//
// After the provider confirms an adult, its callback must call mintAdultCookie()
// (see src/app/api/age/callback/route.ts, currently a 501 stub).
//
// For local development only, AGE_VERIFICATION_PROVIDER=dev issues the cookie on
// request. It is refused on Vercel production (VERCEL_ENV=production).
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADULT_COOKIE = "adult_v";
const MAX_AGE_S = 30 * 24 * 60 * 60;

export function devProviderAllowed(): boolean {
  return process.env.AGE_VERIFICATION_PROVIDER === "dev" && process.env.VERCEL_ENV !== "production";
}

function secret(): string {
  return process.env.AGE_COOKIE_SECRET || (devProviderAllowed() ? "dev-only-secret" : "");
}

export function strangersEnabled(): boolean {
  if (process.env.STRANGERS_ENABLED !== "1") return false;
  return devProviderAllowed() || (!!process.env.AGE_COOKIE_SECRET && !!process.env.AGE_VERIFICATION_URL);
}

export function verifyUrl(): string | null {
  return process.env.AGE_VERIFICATION_URL ?? null;
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

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}
