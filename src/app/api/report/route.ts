import { NextResponse } from "next/server";
import { reportPlayer } from "@/lib/server/rooms";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Report a player in your room. Body: { code, playerId, token, targetId, reason } */
export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    await reportPlayer(String(b.code ?? ""), String(b.playerId ?? ""), String(b.token ?? ""), String(b.targetId ?? ""), b.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
