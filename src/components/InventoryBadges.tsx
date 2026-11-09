import { ITEMS, type Engine, type PlayerView } from "@/lib/wasm/engine";

/** One emoji pip per starting item; lost items are greyed out. */
export function InventoryBadges({ engine, player, size = "md" }: { engine: Engine; player: PlayerView; size?: "sm" | "md" }) {
  const pips: { key: string; icon: string; name: string; on: boolean }[] = [];
  for (const item of ITEMS) {
    const start = engine.startCount(item.id, player.gender);
    for (let j = 0; j < start; j++) {
      pips.push({ key: `${item.id}-${j}`, icon: item.icon, name: item.name, on: j < player.items[item.id] });
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5" aria-label={`${player.total} of 7 items left`}>
      {pips.map((p) => (
        <span
          key={p.key}
          title={`${p.name}${p.on ? "" : " (removed)"}`}
          className={`${size === "sm" ? "text-sm" : "text-lg"} leading-none transition ${p.on ? "" : "opacity-25 grayscale"}`}
        >
          {p.icon}
        </span>
      ))}
    </div>
  );
}
