"use client";

import { useState, useTransition } from "react";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCurses, loadTeams } from "@/lib/queries";
import { curseSpeed } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { clearCurse, syncMySpeed } from "./gameActions";
import { Notice } from "@/components/Notice";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Shows curses on/by this team. Playing and clearing a curse shifts both teams'
// speeds by 1 automatically; if the speed was changed by hand since, a button
// offers to put it back to what the curses add up to.
export function CurseBanner({ teamId }: { teamId: string }) {
  const { data: curses } = useLiveTable("curses", loadCurses);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, startTransition] = useTransition();

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
      setConfirmClear(false);
      refreshAllLiveTables();
    });

  const expected = curseSpeed(teamId, curses.filter((c) => c.status === "active"));
  const speedStatus =
    me.speed === expected ? (
      <p className="text-sm font-semibold">
        Your countdown is running at {expected}×{expected < 0 ? " (going up)" : ""}.
      </p>
    ) : (
      <button
        disabled={pending}
        onClick={() => run(syncMySpeed)}
        className="w-full rounded-lg bg-gray-900 p-3 font-bold text-white disabled:opacity-50"
      >
        Your countdown is at {me.speed}×. Set it back to {expected}×
      </button>
    );

  return (
    <section className="space-y-2">
      <Notice result={result} />

      {onMe && (
        <div className="space-y-2 rounded-xl border-2 border-red-500 bg-red-50 p-4">
          <div className="text-lg font-bold text-red-800">You are cursed!</div>
          <p>
            <b>{name(onMe.attacker_team)}</b> played <b>{onMe.card_name}</b> on you at {time(onMe.started_at)}.
          </p>
          {onMe.clearance && (
            <p>
              <b>To clear it:</b> {onMe.clearance}
            </p>
          )}
          <p className="text-sm">Your countdown runs 1× faster until you clear it.</p>
          {confirmClear ? (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => run(() => clearCurse(onMe.id))}
                className="flex-1 rounded-lg bg-green-600 p-3 font-semibold text-white disabled:opacity-50"
              >
                Yes, we did it
              </button>
              <button onClick={() => setConfirmClear(false)} className="flex-1 rounded-lg border bg-white p-3">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="w-full rounded-lg border-2 border-green-600 bg-white p-3 font-semibold text-green-700"
            >
              We completed the task: curse cleared
            </button>
          )}
        </div>
      )}

      {byMe.map((c) => (
        <div key={c.id} className="space-y-2 rounded-xl border-2 border-orange-400 bg-orange-50 p-4">
          <p>
            Your curse <b>{c.card_name}</b> on <b>{name(c.target_team)}</b> is active (since {time(c.started_at)}). Your
            clock runs 1× slower until they clear it.
          </p>
        </div>
      ))}

      {(onMe || byMe.length > 0) && speedStatus}
    </section>
  );
}
