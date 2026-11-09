import { NextResponse } from "next/server";
import { isAdult, strangersEnabled } from "@/lib/server/age";
import { matchStatus } from "@/lib/server/match";
import { fail, noStore } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!strangersEnabled() || !isAdult(req)) return NextResponse.json({ state: "gone" }, { headers: noStore });
    const ticket = new URL(req.url).searchParams.get("ticket") ?? "";
    return NextResponse.json(await matchStatus(ticket), { headers: noStore });
  } catch (e) {
    return fail(e);
  }
}
