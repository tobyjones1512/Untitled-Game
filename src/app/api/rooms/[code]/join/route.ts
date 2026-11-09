import { NextResponse } from "next/server";
import { joinRoom } from "@/lib/server/rooms";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Join a lobby. Body: { name, gender, consent } */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const b = await readJson(req);
    return NextResponse.json(await joinRoom(code, b.name, b.gender, b.consent));
  } catch (e) {
    return fail(e);
  }
}
