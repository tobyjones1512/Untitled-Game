import Link from "next/link";
import type { GameView } from "@/lib/wasm/engine";
import type { PublicRoom } from "@/lib/types";
import { Modal } from "./Modal";

export function GameOver({ view, room }: { view: GameView; room: PublicRoom }) {
  const winner = view.winner >= 0 ? room.players[view.winner] : null;
  return (
    <Modal title={winner ? `🏆 ${winner.name} wins!` : "It's a draw!"}>
      <p className="text-white/70">
        {winner ? `${winner.name} kept the most clothes on through ${view.round} minigame${view.round === 1 ? "" : "s"}.` : "Nobody has anything left to take off."}
      </p>
      <p className="mt-2 text-sm text-white/55">Thanks for playing. Everyone stays dressed from here on, and please don't share any footage.</p>
      <Link href="/" className="btn-primary mt-5 w-full">
        Back to home
      </Link>
    </Modal>
  );
}
