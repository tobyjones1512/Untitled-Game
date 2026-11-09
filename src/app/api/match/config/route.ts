import { NextResponse } from "next/server";
import { devProviderAllowed, isAdult, strangersEnabled, verifyUrl } from "@/lib/server/age";

export const dynamic = "force-dynamic";

/** Tells the UI whether stranger matchmaking exists and whether this browser is verified. */
export async function GET(req: Request) {
  const verified = strangersEnabled() && isAdult(req);
  // Only show the tab when there's a real way to verify, or this browser already has a pass.
  // (In test-pass mode the public sees nothing; the tester's browser holds the cookie.)
  const enabled = strangersEnabled() && (verifyUrl() !== null || devProviderAllowed() || verified);
  return NextResponse.json({
    enabled,
    verified,
    verifyUrl: verifyUrl(),
    dev: enabled && devProviderAllowed(),
  });
}
