"use client";

import { useState, useTransition } from "react";
import { Countdown } from "@/components/Countdown";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadClocks, loadGameState, loadTeams } from "@/lib/queries";
import { SPEEDS, type ActionResult, type Speed } from "@/lib/types";
import { setMySpeed } from "./gameActions";
import { Notice } from "@/components/Notice";

const SPEED_HELP: Record<Speed, string> = {
  0: "0× — clock stopped (your curse is active on another team)",
  1: "1× — normal",
  2: "2× — you are cursed",
};

export function TeamClockPanel({ teamId }: { teamId: string }) {
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: clocks, error } = useLiveTable("team_clocks", loadClocks);
  const serverNow = useServerNow();
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  if (error) return <p className="text-red-700">Error loading your time: {error}</p>;

  const team = teams?.find((t) => t.id === teamId);
  const clock = clocks?.find((c) => c.team_id === teamId);
  if (!game || !team || !clock || serverNow === null) {
    return <p className="text-gray-500">Loading your time…</p>;
  }

  const chooseSpeed = (speed: Speed) =>
    startTransition(async () => {
      setResult(await setMySpeed(speed));
      // Show the change straight away rather than waiting for realtime.
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
      <Countdown game={game} team={team} clock={clock} serverNow={serverNow} />

      {team.status === "active" && (
        <div className="space-y-1 rounded-xl border bg-white px-3 py-2">
          <div className="text-sm font-semibold">Countdown speed</div>
          <div>
            <div className="grid grid-cols-3 gap-1">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  disabled={pending || speed === team.speed}
                  onClick={() => chooseSpeed(speed)}
                  className={`rounded-md border py-1.5 font-bold ${
                    speed === team.speed ? "border-gray-900 bg-gray-900 text-white" : "bg-white"
                  } disabled:cursor-default`}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-600">{SPEED_HELP[team.speed]}</p>
          <p className="text-xs text-gray-500">
            Curses set this automatically. Only change it by hand to fix a mistake.
          </p>
          {result && !result.ok && <Notice compact result={result} />}
        </div>
      )}
    </section>
  );
}
