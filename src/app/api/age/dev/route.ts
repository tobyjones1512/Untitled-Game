import { NextResponse } from "next/server";
import { devProviderAllowed, mintAdultCookie } from "@/lib/server/age";

export const dynamic = "force-dynamic";

/** LOCAL DEV ONLY: pretend to be verified. Refuses on Vercel production. */
export async function POST() {
  if (!devProviderAllowed()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const c = mintAdultCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: c.maxAge, secure: process.env.NODE_ENV === "production" });
  return res;
}
