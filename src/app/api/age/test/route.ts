import { NextResponse } from "next/server";
import { mintAdultCookie, strangersEnabled, testKeyMatches } from "@/lib/server/age";

export const dynamic = "force-dynamic";

/** TEST PASS: /api/age/test?key=<AGE_TEST_KEY> marks this browser as verified, then opens Quick match. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!strangersEnabled() || !testKeyMatches(url.searchParams.get("key") ?? "")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const c = mintAdultCookie();
  const res = NextResponse.redirect(new URL("/?match=1", url.origin));
  res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: c.maxAge, secure: process.env.NODE_ENV === "production" });
  return res;
}
