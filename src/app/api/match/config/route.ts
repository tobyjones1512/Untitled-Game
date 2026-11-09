import { NextResponse } from "next/server";
import { devProviderAllowed, isAdult, strangersEnabled, verifyUrl } from "@/lib/server/age";

export const dynamic = "force-dynamic";

/** Tells the UI whether stranger matchmaking exists and whether this browser is verified. */
export async function GET(req: Request) {
  const enabled = strangersEnabled();
  return NextResponse.json({
    enabled,
    verified: enabled && isAdult(req),
    verifyUrl: verifyUrl(),
    dev: enabled && devProviderAllowed(),
  });
}
