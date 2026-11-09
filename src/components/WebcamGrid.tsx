"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicPlayer, SignalMessage } from "@/lib/types";
import { PLAYER_COLORS } from "@/lib/ui";

interface Props {
  me: PublicPlayer;
  players: PublicPlayer[];
  sendSignal: (to: string, data: unknown) => Promise<void> | void;
  subscribeSignals: (cb: (m: SignalMessage) => void) => () => void;
  /** Rendered over each tile, e.g. inventory badges. */
  overlay?: (player: PublicPlayer) => React.ReactNode;
  highlightId?: string;
  dimIds?: string[];
  /** Called when any peer says "the room changed". */
  onPoke?: () => void;
  /** Filled with a function that pokes every connected peer. */
  pokeRef?: React.MutableRefObject<(() => void) | null>;
}

type Sig =
  | { t: "hello" }
  | { t: "offer"; sdp: RTCSessionDescriptionInit }
  | { t: "answer"; sdp: RTCSessionDescriptionInit }
  | { t: "ice"; c: RTCIceCandidateInit };

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) {
    servers.push({
      urls: url,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/**
 * Full-mesh WebRTC. Every pair of players has one RTCPeerConnection; the player
 * with the lexicographically lower id always creates the offer, so two peers
 * never offer at once. Signalling is relayed through the Vercel API routes.
 * Media never touches our server.
 */
export function WebcamGrid({ me, players, sendSignal, subscribeSignals, overlay, highlightId, dimIds = [], onPoke, pokeRef }: Props) {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState("");
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const queued = useRef(new Map<string, RTCIceCandidateInit[]>());
  const contacted = useRef(new Set<string>());
  const createdAt = useRef(new Map<string, number>());
  const channels = useRef(new Map<string, RTCDataChannel>());
  const onPokeRef = useRef(onPoke);
  onPokeRef.current = onPoke;
  const localRef = useRef<MediaStream | null>(null);
  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(sendSignal);
  sendRef.current = sendSignal;

  // ---- camera
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't access a camera (HTTPS is required).");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        localRef.current = stream;
        setLocal(stream);
      } catch (e) {
        if (!cancelled) setCamError(e instanceof Error ? e.message : "Camera permission was denied.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setReady(false);
      setLocal(null);
    };
  }, []);

  // tiny data channel per pair: "poke" = the room changed, fetch it now.
  // Saves almost all server polling (which is what costs Redis commands).
  useEffect(() => {
    if (!pokeRef) return;
    pokeRef.current = () => channels.current.forEach((dc) => dc.readyState === "open" && dc.send("p"));
    return () => {
      pokeRef.current = null;
    };
  }, [pokeRef]);

  const send = useCallback((to: string, msg: Sig) => {
    void Promise.resolve(sendRef.current(to, msg)).catch(() => undefined);
  }, []);

  const makePeer = useCallback(
    (peerId: string, initiator: boolean) => {
      pcs.current.get(peerId)?.close();
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pcs.current.set(peerId, pc);
      const wire = (dc: RTCDataChannel) => {
        channels.current.set(peerId, dc);
        dc.onmessage = () => onPokeRef.current?.();
      };
      if (initiator) wire(pc.createDataChannel("poke"));
      else pc.ondatachannel = (e) => wire(e.channel);
      createdAt.current.set(peerId, Date.now());
      const stream = localRef.current;
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      else {
        // no camera: still receive everyone else's video
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
      }
      pc.onicecandidate = (e) => e.candidate && send(peerId, { t: "ice", c: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        const s = e.streams[0] ?? new MediaStream([e.track]);
        setRemote((r) => ({ ...r, [peerId]: s }));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") pc.restartIce();
      };
      return pc;
    },
    [send],
  );

  const offerTo = useCallback(
    async (peerId: string) => {
      const pc = makePeer(peerId, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send(peerId, { t: "offer", sdp: pc.localDescription!.toJSON() });
    },
    [makePeer, send],
  );

  const flushQueued = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const q = queued.current.get(peerId) ?? [];
    queued.current.delete(peerId);
    for (const c of q) await pc.addIceCandidate(c).catch(() => undefined);
  }, []);

  // ---- signalling
  useEffect(() => {
    if (!ready) return;
    return subscribeSignals(async (m) => {
      const data = m.data as Sig;
      const from = m.from;
      try {
        if (data.t === "hello") {
          // a peer (re)appeared; the lower id is responsible for offering
          // ignore the echo of a simultaneous start; a real reload comes much later
          if (me.id < from && Date.now() - (createdAt.current.get(from) ?? 0) > 3000) await offerTo(from);
        } else if (data.t === "offer") {
          const pc = makePeer(from, false);
          await pc.setRemoteDescription(data.sdp);
          await flushQueued(from, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send(from, { t: "answer", sdp: pc.localDescription!.toJSON() });
        } else if (data.t === "answer") {
          const pc = pcs.current.get(from);
          if (pc && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(data.sdp);
            await flushQueued(from, pc);
          }
        } else if (data.t === "ice") {
          const pc = pcs.current.get(from);
          if (pc?.remoteDescription) await pc.addIceCandidate(data.c).catch(() => undefined);
          else queued.current.set(from, [...(queued.current.get(from) ?? []), data.c]);
        }
      } catch (e) {
        console.warn("signalling error", e);
      }
    });
  }, [ready, subscribeSignals, me.id, offerTo, makePeer, flushQueued, send]);

  // ---- connect to peers as they appear / disappear
  const peerKey = players.map((p) => p.id).join(",");
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(playersRef.current.map((p) => p.id));
    for (const p of playersRef.current) {
      if (p.id === me.id || contacted.current.has(p.id)) continue;
      contacted.current.add(p.id);
      send(p.id, { t: "hello" });
      if (me.id < p.id) void offerTo(p.id);
    }
    for (const [id, pc] of pcs.current) {
      if (!ids.has(id)) {
        pc.close();
        pcs.current.delete(id);
        contacted.current.delete(id);
        setRemote((r) => {
          const { [id]: _gone, ...rest } = r;
          return rest;
        });
      }
    }
  }, [ready, peerKey, me.id, offerTo, send]);

  useEffect(() => {
    const peers = pcs.current;
    const seen = contacted.current;
    return () => {
      peers.forEach((pc) => pc.close());
      peers.clear();
      seen.clear();
    };
  }, []);

  const toggle = (kind: "audio" | "video") => {
    const tracks = kind === "audio" ? local?.getAudioTracks() : local?.getVideoTracks();
    const next = !(kind === "audio" ? micOn : camOn);
    tracks?.forEach((t) => (t.enabled = next));
    (kind === "audio" ? setMicOn : setCamOn)(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-1">
        {players.map((p) => {
          const isMe = p.id === me.id;
          const stream = isMe ? local : remote[p.id];
          return (
            <Tile
              key={p.id}
              stream={stream ?? null}
              muted={isMe}
              mirrored={isMe}
              name={isMe ? `${p.name} (you)` : p.name}
              color={PLAYER_COLORS[p.index]}
              active={highlightId === p.id}
              dim={dimIds.includes(p.id)}
              placeholder={isMe && camError ? "No camera" : isMe ? "Starting camera..." : "Connecting..."}
            >
              {overlay?.(p)}
            </Tile>
          );
        })}
      </div>

      {camError && (
        <p role="alert" className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">
          {camError} You can still see and play with everyone else, but the game is meant to be played on camera.
        </p>
      )}

      {local && (
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" aria-pressed={!micOn} onClick={() => toggle("audio")}>
            {micOn ? "🎤 Mic on" : "🔇 Muted"}
          </button>
          <button className="btn-ghost flex-1" aria-pressed={!camOn} onClick={() => toggle("video")}>
            {camOn ? "📷 Camera on" : "🙈 Camera off"}
          </button>
        </div>
      )}
    </div>
  );
}

function Tile({
  stream,
  muted,
  mirrored,
  name,
  color,
  active,
  dim,
  placeholder,
  children,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirrored: boolean;
  name: string;
  color: string;
  active: boolean;
  dim: boolean;
  placeholder: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={`relative aspect-[4/3] overflow-hidden rounded-2xl border-2 bg-ink-900 transition ${dim ? "opacity-60" : ""}`}
      style={{ borderColor: active ? color : "rgba(255,255,255,0.1)", boxShadow: active ? `0 0 24px ${color}66` : undefined }}
    >
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`} />
      {!stream && <div className="absolute inset-0 grid place-items-center text-sm text-white/50">{placeholder}</div>}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="truncate">{name}</span>
        </span>
        {children}
      </div>
    </div>
  );
}
