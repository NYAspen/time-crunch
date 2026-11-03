"use client";

import { useState } from "react";
import { Countdown } from "@/components/Countdown";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadClocks, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult } from "@/lib/types";
import { stepMySpeed } from "./gameActions";
import { Notice } from "@/components/Notice";
import { SpeedStepper } from "@/components/SpeedStepper";

export function TeamClockPanel({ teamId }: { teamId: string }) {
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: clocks, error } = useLiveTable("team_clocks", loadClocks);
  const serverNow = useServerNow();
  const [result, setResult] = useState<ActionResult>(null);

  if (error) return <p className="text-red-700">Error loading your time: {error}</p>;

  const team = teams?.find((t) => t.id === teamId);
  const clock = clocks?.find((c) => c.team_id === teamId);
  if (!game || !team || !clock || serverNow === null) {
    return <p className="text-gray-500">Loading your time…</p>;
  }

  const changeSpeed = async (delta: number) => {
    const { result, speed } = await stepMySpeed(delta);
    setResult(result);
    // Show the change straight away rather than waiting for realtime.
    refreshAllLiveTables();
    return speed;
  };

  const active = team.status === "active";

  return (
    <section className="space-y-2">
      <Countdown
        game={game}
        team={team}
        clock={clock}
        serverNow={serverNow}
        // The countdown is a black sign (themes.css), so the arrows use their dark style.
        side={active && <SpeedStepper speed={team.speed} onChange={changeSpeed} vertical dark />}
      />
      {active && (
        <p className="text-xs text-gray-500">
          Speed: curses change it automatically (+1× for each curse on you, −1× for each you played). Only use the
          arrows to fix a mistake.
        </p>
      )}
      {result && !result.ok && <Notice compact result={result} />}
    </section>
  );
}
