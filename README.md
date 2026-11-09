# Last Thread Standing

A Mario Party-style board game for **2-4 adults** played over live webcams. Roll the dice, grab coins, and win the
minigame at the end of every lap, or take a layer off. Last player with clothes on wins.

Next.js (App Router, TypeScript, Tailwind) on Vercel. Game rules run in **WebAssembly**. Video is **peer-to-peer
WebRTC**. No persistent server.

## Rules

| | |
|---|---|
| Wardrobe | Every player starts with exactly **7 items**: shirt, pants/skirt, underwear, 2 shoes, then **men: 2 socks**, **women: 1 sock + bra** |
| Turn | Roll a die and move around the 24-space board |
| Blue space | +3 coins |
| Red space | -3 coins (never below 0) |
| Tailor Shop | Spend coins: **put an item back on** (5) or **force an opponent to strip** (8) |
| Minigame | After every full lap (everyone alive has moved once) all players play a free-for-all minigame at once. Winner gets +5 coins |
| Strip penalty | **Last place removes one item** on camera (their choice) |
| Elimination | 0 items left = out. Last player with clothes wins |
| Tap out | Any player can leave at any time, for any reason, from the header. Always available |

Everyone must confirm they are 18+, that all players consent, and that nobody will record or share footage before
creating or joining a room.

## Architecture

```
assembly/index.ts         Rules engine (AssemblyScript -> Wasm): state machine, inventory, coins, minigame scoring
scripts/build-wasm.mjs    Compiles to public/wasm/game.wasm and embeds it as base64 (src/lib/wasm/embedded.ts)
scripts/test-wasm.mjs     Rules test-suite against the compiled binary (npm test)
src/lib/wasm/engine.ts    Typed wrapper + state decoder, used by BOTH the browser and Vercel functions
src/lib/server/store.ts   Redis-over-REST (Upstash / Vercel KV) with an in-memory dev fallback
src/lib/server/rooms.ts   Room lifecycle, authoritative action handling, event log
src/app/api/rooms/...     create / join / action / signal / events (SSE)
src/components/Gameboard.tsx    Board, dice, coin counters, inventory badges, event feed
src/components/WebcamGrid.tsx   WebRTC full-mesh manager (getUserMedia + RTCPeerConnection)
src/components/TailorShopModal.tsx, StripModal.tsx, MiniGame.tsx, Lobby.tsx, ...
```

**Wasm as the source of truth.** All game state is one flat `i32[80]`. The engine exposes pure actions
(`actRoll`, `actShopBuy`, `actShopForce`, `actSubmit`, `actStrip`, `actForfeit`, ...). A host loads a state array into
Wasm memory, runs exactly one action, and reads it back. There is no clock and no allocation, and the dice come from a
seeded xorshift stored in the state, so the same state + action gives the same result everywhere. The Vercel function
runs it authoritatively (it rejects out-of-turn or illegal actions) and the browser runs the same binary for costs,
the board layout and minigame targets.

**Sync without a socket server.** Vercel functions can't hold WebSockets, so:
- Each room is a JSON doc in Redis, mutated under a short lock (`SET NX PX`).
- `GET /api/rooms/:code/events` is a Server-Sent Events stream that checks Redis once a second, emits `state` when the
  version changes and relays `signal` messages, then closes after ~50s. `EventSource` reconnects automatically.
- Actions are plain `POST`s; the response already contains the new room so the actor sees it instantly.

**Webcams.** Every pair of players gets one `RTCPeerConnection` (the lower player id always offers, so there is no
glare). Offers, answers and ICE candidates travel through `POST /api/rooms/:code/signal` into a per-player Redis list that the SSE stream drains. Media never touches the server.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000, in-memory room store
npm test             # Wasm rules tests
npm run build:wasm   # only needed after editing assembly/index.ts (commit the regenerated files)
```

Camera access needs HTTPS or `localhost`. To test with two players open a second tab (identities are per-tab) or a
second browser.

## Deploy to Vercel

1. Create a **new** Vercel project from this repo (framework: Next.js, no extra build settings).
2. Add a Redis store: **Storage / Marketplace > Upstash Redis** and connect it to the project. It injects
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`, also supported).
   **This is required in production**: without it each serverless instance has its own memory and rooms break.
3. Optional: set `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, `NEXT_PUBLIC_TURN_CREDENTIAL` for a TURN relay.
   STUN-only (the default) works on most home networks but fails behind strict/symmetric NATs.

## Known limits

- Minigame results are reported by each client and only sanity-checked (cap on taps, minimum play time, score
  clamping). Fine for friends, not for competitive play.
- Whether someone actually removes the item is on the honour system and the webcam, as with any strip game.
- SSE polling costs about 1 Redis command per player per second while connected; the free Upstash tier is fine for
  occasional games.
- Rooms expire 6 hours after their last change.
