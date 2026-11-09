export const PLAYER_COLORS = ["#ff4d8d", "#ffc857", "#4de0b0", "#59b8ff"] as const;

export const SPACE_STYLE = [
  { label: "+3", cls: "bg-blue-500/25 border-blue-400/50 text-sky-200", title: "Blue space: win 3 coins" },
  { label: "-3", cls: "bg-rose-500/25 border-rose-400/50 text-rose-200", title: "Red space: lose 3 coins" },
  { label: "✂️", cls: "bg-amber-400/25 border-amber-300/60 text-amber-100", title: "Tailor Shop" },
  { label: "GO", cls: "bg-emerald-400/25 border-emerald-300/60 text-emerald-100", title: "Start" },
] as const;

/** 24 board spaces laid clockwise around the edge of a 7x7 grid. */
export function boardCell(i: number): { row: number; col: number } {
  if (i <= 6) return { row: 0, col: i };
  if (i <= 12) return { row: i - 6, col: 6 };
  if (i <= 18) return { row: 6, col: 18 - i };
  return { row: 24 - i, col: 0 };
}
