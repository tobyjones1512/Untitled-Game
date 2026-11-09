import { NextResponse } from "next/server";
import { exec } from "@/lib/server/store";
import { fail, readJson, noStore } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const BUCKET_MS = 90_000;

/**
 * "People online": each open page sends a heartbeat every ~45s with a random id.
 * Ids go into a Redis HyperLogLog for the current 90s bucket; the count is the
 * union of this bucket and the previous one (anyone seen in the last 90-180s).
 * No identity or IP is stored, just a random per-page-load id inside the HLL.
 * Body: { id }
 */
export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const id = String(b.id ?? "").slice(0, 32);
    const bucket = Math.floor(Date.now() / BUCKET_MS);
    const cur = `online:${bucket}`;
    const prev = `online:${bucket - 1}`;
    const cmds = id
      ? [["PFADD", cur, id], ["EXPIRE", cur, 400], ["PFCOUNT", cur, prev]]
      : [["PFCOUNT", cur, prev]];
    const out = await exec(cmds as (string | number)[][]);
    return NextResponse.json({ online: Number(out[out.length - 1]) || 0 }, { headers: noStore });
  } catch (e) {
    return fail(e);
  }
}
