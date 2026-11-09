import { stripeKey } from "./age";

// Minimal Stripe Identity client (no SDK). Docs: https://docs.stripe.com/identity
// STRIPE_API_BASE exists only so the test-suite can point at a local mock; it is
// ignored on Vercel production.

function base(): string {
  return (process.env.VERCEL_ENV !== "production" && process.env.STRIPE_API_BASE) || "https://api.stripe.com";
}

async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${stripeKey()}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`stripe ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 200)}`);
  return json;
}

/** Start a hosted ID + selfie check. `nonce` ties the result to the browser that started it. */
export async function createAgeSession(returnUrl: string, nonce: string): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams({
    type: "document",
    "options[document][require_matching_selfie]": "true",
    "options[document][require_live_capture]": "true",
    return_url: returnUrl,
    "metadata[nonce]": nonce,
    "metadata[purpose]": "age18",
  });
  const s = await call("/v1/identity/verification_sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (typeof s.id !== "string" || typeof s.url !== "string") throw new Error("stripe: bad session response");
  return { id: s.id, url: s.url };
}

export interface StripeSession {
  id: string;
  status: string; // requires_input | processing | verified | canceled
  metadata?: Record<string, string>;
  verified_outputs?: { dob?: { day: number; month: number; year: number } | null } | null;
}

export async function readSession(id: string): Promise<StripeSession> {
  if (!/^vs_[A-Za-z0-9_]+$/.test(id)) throw new Error("bad session id");
  return (await call(`/v1/identity/verification_sessions/${id}?expand[]=verified_outputs`)) as unknown as StripeSession;
}

export type AgeResult = "adult" | "minor" | "unknown";

/**
 * Decide from a verified session. Real (live) sessions must carry a date of birth that
 * makes the person 18+. Stripe test-mode sessions use sample documents with no real DOB,
 * so with an sk_test_ key a `verified` status is accepted (never possible with live keys).
 */
export function ageFromSession(s: StripeSession, now = new Date()): AgeResult {
  if (s.status !== "verified") return "unknown";
  const dob = s.verified_outputs?.dob;
  if (!dob || !dob.year || !dob.month || !dob.day) {
    return stripeKey().startsWith("sk_test_") || stripeKey().startsWith("rk_test_") ? "adult" : "unknown";
  }
  let age = now.getUTCFullYear() - dob.year;
  const before = now.getUTCMonth() + 1 < dob.month || (now.getUTCMonth() + 1 === dob.month && now.getUTCDate() < dob.day);
  if (before) age--;
  return age >= 18 ? "adult" : "minor";
}
