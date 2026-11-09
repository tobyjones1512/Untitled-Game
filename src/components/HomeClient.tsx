"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MatchSearch } from "./MatchSearch";
import { usePresence } from "@/hooks/usePresence";
import { PlayerForm } from "./PlayerForm";
import { createRoom, devVerify, getMatchConfig, joinQueue, joinRoom, type MatchConfig } from "@/lib/client/api";
import { saveCreds } from "@/lib/client/session";

export function HomeClient() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join" | "match">("create");
  const online = usePresence();
  const [match, setMatch] = useState<MatchConfig | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  useEffect(() => {
    getMatchConfig().then((c) => {
      setMatch(c);
      if (c.enabled && new URLSearchParams(window.location.search).get("match")) setMode("match");
    });
  }, []);
  const stopSearch = useCallback(() => setTicket(null), []);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-10 lg:flex-row lg:items-center lg:gap-14">
      <section className="flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="inline-block rounded-full border border-glow-pink/40 bg-glow-pink/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-glow-pink">
            18+ · 2-4 players · live webcam
          </p>
          {online !== null && (
            <p
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200"
              aria-live="polite"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" />
              {online} online
            </p>
          )}
        </div>
        <h1 className="font-display text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl">
          Last Thread
          <br />
          <span className="bg-gradient-to-r from-glow-pink to-glow-amber bg-clip-text text-transparent">Standing</span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-white/70">
          A party board game played over video. Roll, grab coins, dodge the red spaces, then win the minigame or lose a layer.
        </p>
        <ol className="mt-7 grid max-w-md gap-3 text-sm text-white/75">
          {[
            ["🎲", "Roll to see who goes first, then move around the board. Blue wins coins, red takes them, the tailor sells second chances."],
            ["⚡", "After every lap, everyone plays a quick minigame at once: reflexes, memory, maths and more."],
            ["👕", "Come last and take one item off on camera. Zero items left and you're out."],
          ].map(([icon, text]) => (
            <li key={text} className="flex gap-3">
              <span className="text-xl">{icon}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card w-full max-w-md p-5 sm:p-6">
        <div role="tablist" className={`mb-5 grid rounded-xl bg-black/30 p-1 ${match?.enabled ? "grid-cols-3" : "grid-cols-2"}`}>
          {(match?.enabled ? (["create", "join", "match"] as const) : (["create", "join"] as const)).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`rounded-lg py-2 text-sm font-bold transition ${mode === m ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
              onClick={() => {
                setMode(m);
                setError("");
              }}
            >
              {m === "create" ? "Host a room" : m === "join" ? "Join a room" : "Quick match"}
            </button>
          ))}
        </div>

        {mode === "join" && (
          <div className="mb-5">
            <label className="label" htmlFor="code">
              Room code
            </label>
            <input
              id="code"
              className="input text-center font-mono text-2xl font-bold uppercase tracking-[0.4em]"
              maxLength={5}
              placeholder="ABCDE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
        )}

        {mode === "match" ? (
          ticket ? (
            <MatchSearch ticket={ticket} onCancel={stopSearch} />
          ) : !match?.verified ? (
            <div className="space-y-4 text-center">
              <p className="font-display text-xl font-black">Verify you're an adult</p>
              <p className="text-sm text-white/65">
                Playing with strangers is only for verified adults, because this game is played on camera. Verification is quick and we only keep a pass/fail result.
              </p>
              {match?.dev ? (
                <button
                  className="btn-primary w-full"
                  onClick={async () => {
                    await devVerify();
                    setMatch(await getMatchConfig());
                  }}
                >
                  Dev: pretend I'm verified
                </button>
              ) : (
                <a className="btn-primary w-full" href={match?.verifyUrl ?? "#"}>
                  Verify my age
                </a>
              )}
            </div>
          ) : (
            <PlayerForm
              submitLabel="Find players"
              busy={busy}
              error={error}
              extraConsent="I understand I'll be matched with people I don't know. I can leave or tap out at any time, and I won't record or share anyone's video."
              onSubmit={async ({ name, gender, consent }) => {
                setError("");
                setBusy(true);
                try {
                  setTicket((await joinQueue(name, gender, consent)).ticket);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Something went wrong.");
                } finally {
                  setBusy(false);
                }
              }}
            />
          )
        ) : (
        <PlayerForm
          submitLabel={mode === "create" ? "Create room" : "Join room"}
          busy={busy}
          error={error}
          onSubmit={async ({ name, gender, consent }) => {
            setError("");
            if (mode === "join" && code.trim().length < 5) return setError("Enter the 5 character room code.");
            setBusy(true);
            try {
              const res =
                mode === "create" ? await createRoom(name, gender, consent) : await joinRoom(code.trim(), name, gender, consent);
              saveCreds(res.code, { playerId: res.playerId, token: res.token });
              router.push(`/room/${res.code}`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.");
              setBusy(false);
            }
          }}
        />
        )}
      </section>
    </main>
  );
}
