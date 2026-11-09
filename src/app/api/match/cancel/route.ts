import { NextResponse } from "next/server";
import { cancelQueue } from "@/lib/server/match";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    await cancelQueue(String(b.ticket ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
