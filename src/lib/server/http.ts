import { NextResponse } from "next/server";
import { RoomError } from "./rooms";

export function fail(e: unknown) {
  if (e instanceof RoomError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Server error." }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const noStore = { "Cache-Control": "no-store" };
