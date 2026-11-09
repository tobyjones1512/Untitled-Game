import { NextResponse } from "next/server";
import { devProviderAllowed, isAdult, strangersEnabled } from "@/lib/server/age";

export const dynamic = "force-dynamic";

/** Tells the UI whether stranger matchmaking exists and whether this browser has passed the age check. */
export async function GET(req: Request) {
  const enabled = strangersEnabled();
  return NextResponse.json({
    enabled,
    verified: enabled && isAdult(req),
    dev: enabled && devProviderAllowed(),
  });
}
