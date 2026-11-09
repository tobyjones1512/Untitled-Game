import { NextResponse } from "next/server";
import { isAdult, strangersEnabled, clientIp } from "@/lib/server/age";
import { joinQueue } from "@/lib/server/match";
import { fail, readJson } from "@/lib/server/http";
import { exec } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Enter the public matchmaking queue. Requires the verified-adult cookie. Body: { name, gender, consent } */
export async function POST(req: Request) {
  try {
    if (!strangersEnabled()) return NextResponse.json({ error: "Matchmaking isn't available." }, { status: 404 });
    if (!isAdult(req)) return NextResponse.json({ error: "Age verification required." }, { status: 403 });
    const ip = clientIp(req);
    const [n] = (await exec([["INCR", `rl:match:${ip}`], ["EXPIRE", `rl:match:${ip}`, 60]])) as [number];
    if (n > 10) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
    const b = await readJson(req);
    return NextResponse.json({ ticket: await joinQueue(b.name, b.gender, b.consent) });
  } catch (e) {
    return fail(e);
  }
}
