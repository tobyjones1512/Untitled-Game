import { NextResponse } from "next/server";
import { createRoom } from "@/lib/server/rooms";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Create a room. Body: { name, gender, consent } */
export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const out = await createRoom(b.name, b.gender, b.consent);
    return NextResponse.json(out);
  } catch (e) {
    return fail(e);
  }
}
