import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { clientIp, stripeConfigured } from "@/lib/server/age";
import { createAgeSession } from "@/lib/server/stripeIdentity";
import { exec } from "@/lib/server/store";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Begin Stripe Identity verification. Returns { url } to send the player to. */
export async function POST(req: Request) {
  try {
    if (!stripeConfigured()) return NextResponse.json({ error: "Verification isn't available." }, { status: 404 });
    const ip = clientIp(req);
    const [n] = (await exec([["INCR", `rl:idv:${ip}`], ["EXPIRE", `rl:idv:${ip}`, 600]])) as [number];
    if (n > Number(process.env.IDV_RATE_LIMIT ?? 5)) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });

    const origin = new URL(req.url).origin;
    const nonce = randomBytes(16).toString("hex");
    const session = await createAgeSession(`${origin}/api/age/callback`, nonce);

    const res = NextResponse.json({ url: session.url });
    const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 3600, secure: process.env.NODE_ENV === "production" };
    res.cookies.set("idv_s", session.id, opts);
    res.cookies.set("idv_n", nonce, opts);
    return res;
  } catch (e) {
    return fail(e);
  }
}
