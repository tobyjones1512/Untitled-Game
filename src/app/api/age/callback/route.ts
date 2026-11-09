import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * TODO(age verification): plug your provider in here.
 *
 * 1. The provider redirects the player back to this URL after checking their age.
 * 2. VERIFY the provider's result server-side (signature / token introspection).
 *    Never trust query parameters on their own.
 * 3. Only if the provider confirms an adult:
 *      const c = mintAdultCookie();  // from "@/lib/server/age"
 *      res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: c.maxAge });
 *      return NextResponse.redirect(new URL("/", req.url));
 * Do not store ID documents or birth dates; keep only the signed pass/fail cookie.
 */
export async function GET() {
  return NextResponse.json({ error: "Age verification provider not configured." }, { status: 501 });
}
