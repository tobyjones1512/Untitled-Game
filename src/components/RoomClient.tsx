"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerForm } from "./PlayerForm";
import { Lobby } from "./Lobby";
import { Gameboard } from "./Gameboard";
import { WebcamGrid } from "./WebcamGrid";
import { TailorShopModal } from "./TailorShopModal";
import { StripModal } from "./StripModal";
import { MiniGame } from "./MiniGame";
import { GameOver } from "./GameOver";
import { Modal } from "./Modal";
import { useRoom } from "@/hooks/useRoom";
import { useEngine } from "@/hooks/useEngine";
import { joinRoom, reportPlayer, sendAction, sendSignal } from "@/lib/client/api";
import { clearCreds, loadCreds, saveCreds, type Creds } from "@/lib/client/session";
import { Phase, decodeState } from "@/lib/wasm/engine";
import type { ActionBody } from "@/lib/types";

export function RoomClient({ code }: { code: string }) {
  const [creds, setCreds] = useState<Creds | null | undefined>(undefined);
  useEffect(() => setCreds(loadCreds(code)), [code]);

  if (creds === undefined) return <Splash text="Loading..." />;
  if (!creds) return <JoinPrompt code={code} onJoined={setCreds} />;
  return <RoomView code={code} creds={creds} onLeft={() => setCreds(null)} />;
}

function Splash({ text }: { text: string }) {
  return <main className="grid min-h-screen place-items-center text-white/60">{text}</main>;
}

function JoinPrompt({ code, onJoined }: { code: string; onJoined: (c: Creds) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center px-4 py-10">
      <div className="card w-full p-6">
        <h1 className="font-display text-3xl font-black">
          Join room <span className="font-mono tracking-widest text-glow-amber">{code}</span>
        </h1>
        <div className="mt-5">
          <PlayerForm
            submitLabel="Join room"
            busy={busy}
            error={error}
            onSubmit={async ({ name, gender, consent }) => {
              setBusy(true);
              setError("");
              try {
                const r = await joinRoom(code, name, gender, consent);
                const c = { playerId: r.playerId, token: r.token };
                saveCreds(code, c);
                onJoined(c);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not join.");
                setBusy(false);
              }
            }}
          />
        </div>
        <Link href="/" className="mt-4 block text-center text-sm text-white/50 hover:text-white">
          Back
        </Link>
      </div>
    </main>
  );
}

function RoomView({ code, creds, onLeft }: { code: string; creds: Creds; onLeft: () => void }) {
  const { room, connection, deniedReason, applyRoom, refresh, subscribeSignals, serverNow } = useRoom(code, creds);
  const pokeRef = useRef<(() => void) | null>(null);
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const act = useCallback(
    async (action: ActionBody) => {
      setBusy(true);
      setError("");
      try {
        const res = await sendAction(code, creds, action);
        applyRoom(res.room);
        pokeRef.current?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [code, creds, applyRoom],
  );

  const view = useMemo(() => (room?.state ? decodeState(room.state) : null), [room?.state]);

  // anyone can nudge a stalled minigame past its deadline
  const deadline = room?.mgDeadline ?? null;
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => {
      if (serverNow() > deadline + 400) {
        sendAction(code, creds, { type: "mgTimeout" }).then((r) => applyRoom(r.room)).catch(() => undefined);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [deadline, code, creds, serverNow, applyRoom]);

  // same for the voting timer
  const voteDeadline = room?.voteDeadline ?? null;
  useEffect(() => {
    if (!voteDeadline) return;
    const t = setInterval(() => {
      if (serverNow() > voteDeadline + 400) {
        sendAction(code, creds, { type: "voteTimeout" }).then((r) => applyRoom(r.room)).catch(() => undefined);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [voteDeadline, code, creds, serverNow, applyRoom]);

  // the minigame is queued behind a short pause; re-render until it actually starts
  const mgStartedAt = room?.mgStartedAt ?? null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!mgStartedAt) return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      if (serverNow() >= mgStartedAt) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [mgStartedAt, serverNow]);

  const signal = useCallback((to: string, data: unknown) => sendSignal(code, creds, to, data).then(() => undefined), [code, creds]);

  if (connection === "denied") {
    return (
      <main className="mx-auto grid min-h-screen max-w-md place-items-center px-4">
        <div className="card p-6 text-center">
          <h1 className="font-display text-2xl font-black">Can't open this room</h1>
          <p className="mt-2 text-white/65">{deniedReason}</p>
          <button
            className="btn-primary mt-5"
            onClick={() => {
              clearCreds(code);
              onLeft();
            }}
          >
            Rejoin
          </button>
        </div>
      </main>
    );
  }
  if (!room || !engine) return <Splash text={connection === "connecting" ? "Connecting to room..." : "Loading..."} />;

  const me = room.players.find((p) => p.id === creds.playerId);
  if (!me) {
    return (
      <main className="mx-auto grid min-h-screen max-w-md place-items-center px-4">
        <div className="card p-6 text-center">
          <p className="text-white/70">You're no longer in this room.</p>
          <Link href="/" className="btn-primary mt-4" onClick={() => clearCreds(code)}>
            Home
          </Link>
        </div>
      </main>
    );
  }

  const meView = view?.players[me.index];
  const playing = room.status !== "lobby" && !!view;
  const iAmOut = !!meView && !meView.alive;
  const currentId = view && playing ? room.players[view.cur]?.id : undefined;

  return (
    <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-display text-lg font-black tracking-tight">
            Last Thread <span className="text-glow-pink">Standing</span>
          </Link>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-xs font-bold tracking-widest">{room.code}</span>
          {playing && <span className="text-xs text-white/50">Round {Math.max(1, view.round + (view.phase === Phase.MINI ? 0 : 1))}</span>}
          {connection !== "live" && <span className="text-xs text-amber-300">reconnecting...</span>}
        </div>
        <div className="flex gap-2">
          {room.public && (
            <button className="btn-ghost" onClick={() => setReporting(true)}>
              Report
            </button>
          )}
          {playing && !iAmOut && room.status === "playing" && (
            <button className="btn-danger" onClick={() => setConfirmQuit(true)}>
              Tap out
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" onClick={() => setError("")}>
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 lg:order-1">
          {playing ? (
            <Gameboard engine={engine} room={room} view={view} meIndex={me.index} busy={busy} act={act} minigamePending={view.phase === Phase.MINI && !!room.mgStartedAt && serverNow() < room.mgStartedAt} />
          ) : (
            <Lobby
              room={room}
              meId={me.id}
              busy={busy}
              onStart={() => act({ type: "start" })}
              onLeave={async () => {
                await act({ type: "leaveLobby" });
                clearCreds(code);
                onLeft();
              }}
            />
          )}
        </div>
        <aside className="order-1 lg:order-2">
          <WebcamGrid
            me={me}
            players={room.players}
            sendSignal={signal}
            subscribeSignals={subscribeSignals}
            highlightId={currentId}
            onPoke={refresh}
            pokeRef={pokeRef}
            dimIds={view ? room.players.filter((p) => !view.players[p.index]?.alive).map((p) => p.id) : []}
            overlay={(p) => {
              const pv = view?.players[p.index];
              if (!pv) return null;
              return (
                <div className="flex items-center justify-between gap-2 text-xs font-black">
                  <span className="text-white/70">{pv.alive ? `${pv.total}/7 items` : "Out"}</span>
                  <span className="text-glow-amber">🪙 {pv.coins}</span>
                </div>
              );
            }}
          />
        </aside>
      </div>

      {playing && view && room.status === "playing" && !iAmOut && (
        <>
          {view.phase === Phase.SHOP && view.cur === me.index && (
            <TailorShopModal engine={engine} view={view} room={room} meIndex={me.index} busy={busy} act={act} />
          )}
          {view.phase === Phase.STRIP && (
            <StripModal engine={engine} view={view} room={room} meIndex={me.index} busy={busy} act={act} serverNow={serverNow} />
          )}
          {view.phase === Phase.MINI && room.mgStartedAt && serverNow() >= room.mgStartedAt && (
            <MiniGame
              key={`${view.round}`}
              engine={engine}
              view={view}
              meIndex={me.index}
              startedAt={room.mgStartedAt}
              serverNow={serverNow}
              onSubmit={(raw) => act({ type: "submit", raw })}
            />
          )}
        </>
      )}

      {playing && iAmOut && room.status === "playing" && (
        <p className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl border border-white/15 bg-ink-800/95 p-3 text-center text-sm text-white/80 shadow-lg">
          You're out of the game. Stay on and watch the rest!
        </p>
      )}

      {room.status === "over" && view && <GameOver view={view} room={room} />}

      {reporting && (
        <Modal title="Report a player">
          <p className="text-sm text-white/65">Reports are reviewed. You can also tap out or leave at any time.</p>
          {reported ? (
            <p className="mt-4 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-100">Thanks, we've recorded your report.</p>
          ) : (
            <div className="mt-4 grid gap-2">
              {room.players
                .filter((p) => p.id !== me.id)
                .map((p) => (
                  <button
                    key={p.id}
                    className="btn-danger justify-start"
                    onClick={async () => {
                      await reportPlayer(code, creds, p.id, "reported from room").catch(() => undefined);
                      setReported(true);
                    }}
                  >
                    Report {p.name}
                  </button>
                ))}
            </div>
          )}
          <button
            className="btn-ghost mt-4 w-full"
            onClick={() => {
              setReporting(false);
              setReported(false);
            }}
          >
            Close
          </button>
        </Modal>
      )}

      {confirmQuit && (
        <Modal title="Tap out?">
          <p className="text-white/70">You'll leave the game immediately. No penalty, no questions. The others carry on.</p>
          <div className="mt-5 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setConfirmQuit(false)}>
              Keep playing
            </button>
            <button
              className="btn-danger flex-1"
              onClick={async () => {
                setConfirmQuit(false);
                await act({ type: "forfeit" });
              }}
            >
              Tap out
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
