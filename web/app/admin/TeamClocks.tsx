"use client";

import { useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Countdown } from "@/components/Countdown";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadClocks, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, GameState, PublicTeam, TeamClock } from "@/lib/types";
import { adjustTime, setTeamStatus, stepTeamSpeed } from "./adminActions";
import { Notice } from "@/components/Notice";
import { SpeedStepper } from "@/components/SpeedStepper";

export function TeamClocks() {
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: clocks, error } = useLiveTable("team_clocks", loadClocks);
  const serverNow = useServerNow();

  if (error) return <p className="text-red-700">Error: {error}</p>;
  if (!game || !teams || !clocks || serverNow === null) return <p className="text-gray-500">Loading clocks…</p>;

  // Show the result of an admin action straight away rather than waiting for realtime.
  const refreshAll = refreshAllLiveTables;
  const activeCount = teams.filter((t) => t.status === "active").length;

  return (
    <CollapsibleSection title="Team time" summary={`${activeCount} active`} defaultOpen>
      {teams.length === 0 && <p className="text-gray-500">No teams yet.</p>}
      <ul className="space-y-2">
        {teams.map((team) => {
          const clock = clocks.find((c) => c.team_id === team.id);
          return clock ? (
            <ClockRow
              key={team.id}
              game={game}
              team={team}
              clock={clock}
              serverNow={serverNow}
              onChanged={refreshAll}
            />
          ) : null;
        })}
      </ul>
    </CollapsibleSection>
  );
}

function ClockRow({
  game,
  team,
  clock,
  serverNow,
  onChanged,
}: {
  game: GameState;
  team: PublicTeam;
  clock: TeamClock;
  serverNow: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      onChanged();
    });
  const eliminated = team.status === "eliminated";

  return (
    <li
      className={`space-y-2 rounded-lg border p-3 ${team.speed !== 1 && !eliminated ? "border-2 border-l-8 border-orange-600" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-medium ${eliminated ? "text-gray-400 line-through" : ""}`}>{team.name}</span>
        <div className="flex items-center gap-2">
          {!eliminated && team.speed !== 1 && (
            <span className="rounded-sm border-2 border-orange-600 px-1 text-xs font-bold text-orange-700">{team.speed}×</span>
          )}
          <Countdown game={game} team={team} clock={clock} serverNow={serverNow} size="small" />
          <button onClick={() => setOpen(!open)} className="rounded border px-2 py-1 text-sm">
            {open ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3">
          <form action={(fd) => run(() => adjustTime(team.id, fd))} className="space-y-2">
            <div className="flex gap-2">
              <input
                name="minutes"
                type="number"
                step="any"
                required
                placeholder="± minutes"
                className="w-28 rounded border p-2"
              />
              <input name="reason" required placeholder="Reason" className="min-w-0 flex-1 rounded border p-2" />
            </div>
            <button
              disabled={pending}
              className="w-full rounded bg-gray-800 p-2 text-sm text-white disabled:opacity-50"
            >
              Add / subtract time
            </button>
          </form>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">Speed (each tap moves 1×):</span>
            <SpeedStepper
              speed={team.speed}
              onChange={async (delta) => {
                const { result, speed } = await stepTeamSpeed(team.id, delta);
                setResult(result);
                onChanged();
                return speed;
              }}
            />
          </div>

          {confirmStatus ? (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => {
                  setConfirmStatus(false);
                  run(() => setTeamStatus(team.id, eliminated ? "active" : "eliminated"));
                }}
                className="flex-1 rounded bg-red-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Yes, {eliminated ? "bring back" : "eliminate"} {team.name}
              </button>
              <button onClick={() => setConfirmStatus(false)} className="flex-1 rounded border p-2 text-sm">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmStatus(true)}
              className="w-full rounded border border-red-300 p-2 text-sm text-red-700"
            >
              {eliminated ? "Bring team back into the game" : "Eliminate team by hand"}
            </button>
          )}
          {eliminated && (
            <p className="text-xs text-gray-500">
              Tip: add time first. A team brought back with 0 time during Elimination is eliminated again immediately.
            </p>
          )}
        </div>
      )}
      <Notice compact result={result} />
    </li>
  );
}
