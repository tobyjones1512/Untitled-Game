import { NextResponse } from "next/server";
import { mintAdultCookie, readCookie, stripeConfigured } from "@/lib/server/age";
import { ageFromSession, readSession } from "@/lib/server/stripeIdentity";
import { run } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * Stripe sends the player back here after the hosted check. We never trust the redirect
 * itself: the session is re-read from Stripe with our secret key.
 *  - must be the session THIS browser started (cookie id + nonce in Stripe metadata)
 *  - must be `verified`, with a date of birth that makes them 18+
 *  - each verified session can mint a pass only once (no sharing one check)
 */
export async function GET(req: Request) {
  const to = (state: string, extra = "") => {
    const res = NextResponse.redirect(new URL(`/?match=1&verify=${state}${extra}`, new URL(req.url).origin));
    return res;
  };
  if (!stripeConfigured()) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const id = readCookie(req, "idv_s");
  const nonce = readCookie(req, "idv_n");
  if (!id || !nonce) return to("expired");

  try {
    const s = await readSession(id);
    if (s.metadata?.nonce !== nonce) return to("expired");
    if (s.status === "processing") return to("pending");
    if (s.status !== "verified") return to("failed");

    const age = ageFromSession(s);
    if (age === "minor") return to("minor");
    if (age !== "adult") return to("failed");

    const first = await run(["SET", `idv:used:${id}`, "1", "NX", "EX", 30 * 24 * 3600]);
    if (first !== "OK") return to("failed"); // this check was already redeemed

    const c = mintAdultCookie();
    const res = to("ok");
    res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: c.maxAge, secure: process.env.NODE_ENV === "production" });
    res.cookies.delete("idv_s");
    res.cookies.delete("idv_n");
    return res;
  } catch (e) {
    console.error("age callback", e);
    return to("error");
  }
}
