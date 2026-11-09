import { NextResponse } from "next/server";
import { applyAction } from "@/lib/server/rooms";
import { fail, readJson } from "@/lib/server/http";
import type { ActionBody } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Any game action. Body: { playerId, token, action: ActionBody } */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const b = await readJson(req);
    const action = b.action as ActionBody | undefined;
    if (!action || typeof action.type !== "string") return NextResponse.json({ error: "Missing action." }, { status: 400 });
    const room = await applyAction(code, String(b.playerId ?? ""), String(b.token ?? ""), action);
    return NextResponse.json({ room });
  } catch (e) {
    return fail(e);
  }
}
