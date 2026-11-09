"use client";

import { useState } from "react";
import type { Gender } from "@/lib/wasm/engine";

interface Props {
  submitLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (v: { name: string; gender: Gender; consent: true }) => void;
  /** Extra required checkbox (used for stranger matchmaking). */
  extraConsent?: string;
}

const CONSENT = [
  "I am 18 or older, and so is everyone I'm playing with.",
  "Everyone in this room has agreed to play. I won't pressure anyone, and I won't record, screenshot or share anyone's video.",
  "I understand anyone can tap out at any time, for any reason, and the game simply continues.",
];

export function PlayerForm({ submitLabel, busy, error, onSubmit, extraConsent }: Props) {
  const consentList = extraConsent ? [...CONSENT, extraConsent] : CONSENT;
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [checks, setChecks] = useState<boolean[]>([]);
  const ready = name.trim().length > 0 && gender !== null && consentList.every((_, i) => checks[i]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && gender) onSubmit({ name: name.trim(), gender, consent: true });
      }}
    >
      <div>
        <label className="label" htmlFor="name">
          Display name
        </label>
        <input id="name" className="input" maxLength={16} autoComplete="nickname" placeholder="e.g. Sam" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <fieldset>
        <legend className="label">Starting wardrobe</legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["man", "Man", "Shirt, pants, underwear, 2 shoes, 2 socks"],
              ["woman", "Woman", "Shirt, skirt/pants, underwear, bra, 2 shoes, 1 sock"],
            ] as const
          ).map(([value, title, desc]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-xl border p-3 text-left transition ${
                gender === value ? "border-glow-pink bg-glow-pink/10" : "border-white/15 bg-white/5 hover:bg-white/10"
              }`}
            >
              <input type="radio" name="gender" className="sr-only" checked={gender === value} onChange={() => setGender(value)} />
              <span className="block font-bold">{title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-white/60">{desc}</span>
              <span className="mt-1 block text-xs font-bold text-glow-amber">7 items</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2.5 rounded-xl border border-white/10 bg-black/20 p-3.5">
        <legend className="label px-1">Before you play</legend>
        {consentList.map((text, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-white/80">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-pink-500"
              checked={!!checks[i]}
              onChange={(e) => setChecks((c) => consentList.map((_, j) => (j === i ? e.target.checked : !!c[j])))}
            />
            <span>{text}</span>
          </label>
        ))}
        <p className="pt-1 text-xs text-white/45">Video is peer-to-peer between players. Our server only relays connection handshakes and never sees or stores your camera.</p>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full py-3 text-base" disabled={!ready || busy}>
        {busy ? "One moment..." : submitLabel}
      </button>
    </form>
  );
}
