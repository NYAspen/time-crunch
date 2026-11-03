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
  side?: React.ReactNode; // shown inside the large box, right of the time (the team's speed arrows)
  children?: React.ReactNode; // shown inside the large box, under the time
};

export function Countdown({ game, team, clock, serverNow, size = "large", side, children }: Props) {
  const remaining = remainingMs(clock, serverNow);
  const running = clock.running;
  useEliminationCheck(game.phase === "elimination" && team.status === "active" && remaining <= 0);

  const text = formatClock(remaining);

  if (size === "small") {
    return <span className={`font-mono tabular-nums ${running ? "" : "text-gray-500"}`}>{text}</span>;
  }

  // One span per character, so themes can draw split-flap tiles (themes.css).
  const time = (
    <span className="font-mono tabular-nums">
      {[...text].map((ch, i) => (
        <span key={i} className={/\d/.test(ch) ? "tc-flap" : "tc-flap-sep"}>
          {ch}
        </span>
      ))}
    </span>
  );

  let caption = "Banked time (not counting down yet)";
  if (team.status === "eliminated") caption = "Eliminated";
  else if (game.phase === "elimination" && game.is_paused) caption = "Paused";
  else if (running && clock.speed < 0) caption = `Time left · going up at ${-clock.speed}×`;
  else if (running) caption = clock.speed === 1 ? "Time left" : `Time left · counting at ${clock.speed}×`;

  return (
    <div
      data-state={team.status === "eliminated" ? "eliminated" : running ? "running" : "banked"}
      className={`tc-countdown rounded-xl p-4 text-center ${
        team.status === "eliminated" ? "bg-gray-300 text-gray-700" : running ? "bg-gray-900 text-white" : "bg-white"
      }`}
    >
      {side ? (
        // Caption and time on the left; the speed column on the right, centred
        // top-to-bottom against both.
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="tc-caption text-sm uppercase tracking-wide opacity-80">{caption}</div>
            {/* Smaller on narrow phones so the time and the speed fit side by side. */}
            <div className="tc-digits font-bold" style={{ fontSize: "clamp(2.25rem, 12.5vw, 3.75rem)" }}>
              {time}
            </div>
          </div>
          {side}
        </div>
      ) : (
        <>
          <div className="tc-caption text-sm uppercase tracking-wide opacity-80">{caption}</div>
          <div className="tc-digits text-5xl font-bold">{time}</div>
        </>
      )}
      {children}
    </div>
  );
}
