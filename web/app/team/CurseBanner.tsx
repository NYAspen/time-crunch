"use client";

import { useState, useTransition } from "react";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCurses, loadTeams } from "@/lib/queries";
import { curseSpeed } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { clearCurse, syncMySpeed, vetoCurse } from "./gameActions";
import { useHasVeto } from "./StealAlert";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

// Shows curses on/by this team. Playing and clearing a curse shifts both teams'
// speeds by 1 automatically; if the speed was changed by hand since, a button
// offers to put it back to what the curses add up to.
export function CurseBanner({ teamId }: { teamId: string }) {
  const { data: curses } = useLiveTable("curses", loadCurses);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);
  const [confirm, setConfirm] = useState<"clear" | "veto" | null>(null);
  const [pending, startTransition] = useTransition();
  const hasVeto = useHasVeto(teamId);

  if (!curses || !teams) return null;
  const me = teams.find((t) => t.id === teamId);
  if (!me || me.status !== "active") return null;

  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "another team";
  const onMe = curses.find((c) => c.status === "active" && c.target_team === teamId);
  const byMe = curses.filter((c) => c.status === "active" && c.attacker_team === teamId);

  if (!onMe && byMe.length === 0 && !result) return null;

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      setConfirm(null);
      refreshAllLiveTables();
    });

  // Only shown when a speed was changed by hand since: the countdown already
  // shows the current speed.
  const expected = curseSpeed(teamId, curses.filter((c) => c.status === "active"));
  const speedFix = me.speed !== expected && (
    <button
      disabled={pending}
      onClick={() => run(syncMySpeed)}
      className="w-full rounded-lg bg-gray-900 p-2 text-sm font-bold text-white disabled:opacity-50"
    >
      Your countdown is at {me.speed}×. Set it back to {expected}×
    </button>
  );

  // Kept short: just the curse and the team, plus what the cursed team needs
  // to clear it.
  return (
    <section className="space-y-2">
      <Notice result={result} />

      {onMe && (
        <SignBox
          tone="red"
          compact
          title={
            <>
              ! Cursed: {onMe.card_name} <span className="font-normal">by {name(onMe.attacker_team)}</span>
            </>
          }
        >
          {onMe.clearance && (
            <p>
              <b>To clear:</b> {onMe.clearance}
            </p>
          )}
          {confirm ? (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => run(() => (confirm === "clear" ? clearCurse(onMe.id) : vetoCurse(onMe.id)))}
                className={`flex-1 rounded-lg p-2 font-semibold text-white disabled:opacity-50 ${
                  confirm === "clear" ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {confirm === "clear" ? "Yes, we did it" : "Yes, use Veto"}
              </button>
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-lg border bg-white p-2">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirm("clear")}
                className="flex-1 rounded-lg border-2 border-green-600 bg-white p-2 font-semibold text-green-700"
              >
                Task done
              </button>
              {hasVeto && (
                <button
                  onClick={() => setConfirm("veto")}
                  className="flex-1 rounded-lg border-2 border-red-600 bg-white p-2 font-semibold text-red-700"
                >
                  Veto
                </button>
              )}
            </div>
          )}
        </SignBox>
      )}

      {byMe.map((c) => (
        <SignBox
          key={c.id}
          tone="orange"
          compact
          title={
            <>
              Your curse: {c.card_name} <span className="font-normal">on {name(c.target_team)}</span>
            </>
          }
        />
      ))}

      {speedFix}
    </section>
  );
}
