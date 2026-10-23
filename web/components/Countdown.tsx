"use client";

import { formatClock, remainingMs } from "@/lib/time";
import type { GameState, PublicTeam, TeamClock } from "@/lib/types";
import { useEliminationCheck } from "./useEliminationCheck";

type Props = {
  game: GameState;
  team: PublicTeam;
  clock: TeamClock;
  serverNow: number;
  size?: "large" | "small";
};

export function Countdown({ game, team, clock, serverNow, size = "large" }: Props) {
  const remaining = remainingMs(clock, serverNow);
  const running = clock.running;
  useEliminationCheck(game.phase === "elimination" && team.status === "active" && remaining <= 0);

  const time = <span className="font-mono tabular-nums">{formatClock(remaining)}</span>;

  if (size === "small") {
    return <span className={running ? "" : "text-gray-500"}>{time}</span>;
  }

  let caption = "Banked time (not counting down yet)";
  if (team.status === "eliminated") caption = "Eliminated";
  else if (game.phase === "elimination" && game.is_paused) caption = "Paused";
  else if (running) caption = clock.speed === 1 ? "Time left" : `Time left · counting at ${clock.speed}×`;

  return (
    <div
      className={`rounded-xl p-4 text-center ${
        team.status === "eliminated" ? "bg-gray-300 text-gray-700" : running ? "bg-gray-900 text-white" : "bg-white"
      }`}
    >
      <div className="text-sm uppercase tracking-wide opacity-80">{caption}</div>
      <div className="text-5xl font-bold">{time}</div>
    </div>
  );
}
