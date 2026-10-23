"use client";

import { useState, useTransition } from "react";
import { Countdown } from "@/components/Countdown";
import { TimeHistory } from "@/components/TimeHistory";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadClocks, loadGameState, loadLedger, loadTeams } from "@/lib/queries";
import { SPEEDS, type ActionResult, type Speed } from "@/lib/types";
import { setMySpeed } from "./actions";

const SPEED_HELP: Record<Speed, string> = {
  0: "0× — clock stopped (your curse is active on another team)",
  1: "1× — normal",
  2: "2× — you are cursed",
};

export function TeamClockPanel({ teamId }: { teamId: string }) {
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: clocks, error } = useLiveTable("team_clocks", loadClocks);
  const { data: ledger } = useLiveTable("time_ledger", loadLedger);
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
        <div className="space-y-2 rounded-xl border bg-white p-4">
          <div className="font-semibold">Countdown speed</div>
          <div className="grid grid-cols-3 gap-2">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                disabled={pending || speed === team.speed}
                onClick={() => chooseSpeed(speed)}
                className={`rounded-lg border p-3 text-xl font-bold ${
                  speed === team.speed ? "border-gray-900 bg-gray-900 text-white" : "bg-white"
                } disabled:cursor-default`}
              >
                {speed}×
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-600">{SPEED_HELP[team.speed]}</p>
          <p className="text-xs text-gray-500">
            Curses set this automatically. Only change it by hand to fix a mistake: every team can see your speed,
            and every change is logged.
          </p>
          {result && !result.ok && <p className="rounded-lg bg-red-100 p-2 text-sm text-red-800">{result.message}</p>}
        </div>
      )}

      <details className="rounded-xl border bg-white p-4">
        <summary className="font-semibold">Time history</summary>
        <div className="mt-2">{ledger && <TimeHistory entries={ledger} />}</div>
      </details>
    </section>
  );
}
