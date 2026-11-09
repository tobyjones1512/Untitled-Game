import { NextResponse } from "next/server";
import { sendSignal } from "@/lib/server/rooms";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Relay a WebRTC signalling message. Body: { playerId, token, to, data } */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const b = await readJson(req);
    await sendSignal(code, String(b.playerId ?? ""), String(b.token ?? ""), String(b.to ?? ""), b.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
