import { randomInt } from "node:crypto";

// All dice come from the operating system's CSPRNG (node:crypto), NOT from the
// game's seeded generator, so rolls can't be predicted or replayed. randomInt
// uses rejection sampling, so there is no modulo bias.

/** A fair six-sided die. */
export function rollDie(): number {
  return randomInt(1, 7);
}

/** Fresh entropy mixed into the engine's internal RNG on every roll. */
export function entropy(): number {
  return randomInt(1, 2 ** 31 - 1);
}

/** Turn-order roll: a fair pick among the faces nobody else has rolled yet, so no two players tie. */
export function pickUnique(taken: number[]): number {
  const free = [1, 2, 3, 4, 5, 6].filter((n) => !taken.includes(n));
  if (free.length === 0) throw new Error("no free faces left");
  return free[randomInt(free.length)];
}
