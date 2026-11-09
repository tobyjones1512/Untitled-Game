"use client";

import { useEffect, useRef } from "react";

export function Modal({ title, children, tone = "default" }: { title: string; children: React.ReactNode; tone?: "default" | "alert" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card max-h-[92vh] w-full max-w-lg animate-pop overflow-y-auto p-5 outline-none sm:p-6 ${
          tone === "alert" ? "border-glow-pink/60" : ""
        }`}
      >
        <h2 className="font-display text-2xl font-black tracking-tight">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
