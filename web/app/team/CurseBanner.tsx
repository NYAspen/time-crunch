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

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
        <SignBox tone="red" title="! You are cursed">
          <p>
            <b>{name(onMe.attacker_team)}</b> played <b>{onMe.card_name}</b> on you at {time(onMe.started_at)}.
          </p>
          {onMe.clearance && (
            <p>
              <b>To clear it:</b> {onMe.clearance}
            </p>
          )}
          <p className="text-sm">Your countdown runs 1× faster until you clear it.</p>
          {confirm === "clear" ? (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => run(() => clearCurse(onMe.id))}
                className="flex-1 rounded-lg bg-green-600 p-3 font-semibold text-white disabled:opacity-50"
              >
                Yes, we did it
              </button>
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-lg border bg-white p-3">
                Cancel
              </button>
            </div>
          ) : confirm === "veto" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Use your Veto card to cancel this curse?</p>
              <div className="flex gap-2">
                <button
                  disabled={pending}
                  onClick={() => run(() => vetoCurse(onMe.id))}
                  className="flex-1 rounded-lg bg-red-600 p-3 font-semibold text-white disabled:opacity-50"
                >
                  Yes, veto it
                </button>
                <button onClick={() => setConfirm(null)} className="flex-1 rounded-lg border bg-white p-3">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => setConfirm("clear")}
                className="w-full rounded-lg border-2 border-green-600 bg-white p-3 font-semibold text-green-700"
              >
                We completed the task: curse cleared
              </button>
              {hasVeto && (
                <button
                  onClick={() => setConfirm("veto")}
                  className="w-full rounded-lg border-2 border-red-600 bg-white p-3 font-semibold text-red-700"
                >
                  Use Veto to cancel this curse
                </button>
              )}
            </>
          )}
        </SignBox>
      )}

      {byMe.map((c) => (
        <SignBox key={c.id} tone="orange" title="Your curse is active">
          <p>
            Your curse <b>{c.card_name}</b> on <b>{name(c.target_team)}</b> is active (since {time(c.started_at)}). Your
            clock runs 1× slower until they clear it.
          </p>
        </SignBox>
      ))}

      {(onMe || byMe.length > 0) && speedStatus}
    </section>
  );
}
