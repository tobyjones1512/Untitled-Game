import { NextResponse } from "next/server";
import { getPublicRoom } from "@/lib/server/rooms";
import { fail, noStore } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One-shot snapshot of the room (the SSE stream is the live version). */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    return NextResponse.json(await getPublicRoom(code), { headers: noStore });
  } catch (e) {
    return fail(e);
  }
}
