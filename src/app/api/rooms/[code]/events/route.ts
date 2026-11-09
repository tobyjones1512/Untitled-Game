import { exec } from "@/lib/server/store";
import { authFromDoc, normaliseCode, parseRoom, sigKey, toPublic } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Serverless functions can't hold a socket forever, so each stream lives for
// ~50s then says goodbye; EventSource reconnects on its own (retry: 300).
export const maxDuration = 60;

// Redis commands are the scarce resource on the free Upstash tier (500K/month).
// Poll quickly for the first few seconds of a stream (catches the initial state
// and WebRTC handshakes), then slowly. Live updates normally arrive instantly via
// a peer "poke" over the WebRTC data channel, so this is only the fallback.
const FAST_MS = 1000;
const FAST_FOR_MS = 3000;
const SLOW_MS = 5000;
const LIFETIME_MS = 50_000;

/**
 * Server-Sent Events: pushes `state` whenever the room version changes and
 * relays WebRTC `signal` messages addressed to this player.
 * Query: ?playerId=..&token=..
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normaliseCode(rawCode);
  const url = new URL(req.url);
  const playerId = url.searchParams.get("playerId") ?? "";
  const token = url.searchParams.get("token") ?? "";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      controller.enqueue(enc.encode("retry: 300\n\n"));
      const started = Date.now();
      let lastVersion = -1;
      let closed = false;
      req.signal.addEventListener("abort", () => (closed = true));

      try {
        while (!closed && Date.now() - started < LIFETIME_MS) {
          const [roomRaw, sigs] = (await exec([
            ["GET", `room:${code}`],
            ["LPOP", sigKey(code, playerId), 50],
          ])) as [string | null, string[] | null];

          const doc = parseRoom(roomRaw);
          if (!authFromDoc(doc, playerId, token)) {
            send("denied", { error: doc ? "Not authorised." : "Room not found." });
            break;
          }
          if (doc!.version !== lastVersion) {
            lastVersion = doc!.version;
            send("state", toPublic(doc!));
          }
          for (const s of sigs ?? []) controller.enqueue(enc.encode(`event: signal\ndata: ${s}\n\n`));
          controller.enqueue(enc.encode(": hb\n\n"));
          await new Promise((r) => setTimeout(r, Date.now() - started < FAST_FOR_MS ? FAST_MS : SLOW_MS));
        }
        if (!closed) send("bye", {});
      } catch (e) {
        console.error("sse error", e);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
