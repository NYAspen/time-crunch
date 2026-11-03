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
  // Which curse's button was tapped (a team can have several curses on it).
  const [confirm, setConfirm] = useState<{ id: string; kind: "clear" | "veto" } | null>(null);
  const [pending, startTransition] = useTransition();
  const hasVeto = useHasVeto(teamId);

  if (!curses || !teams) return null;
  const me = teams.find((t) => t.id === teamId);
  if (!me || me.status !== "active") return null;

  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "another team";
  const onMe = curses.filter((c) => c.status === "active" && c.target_team === teamId);
  const byMe = curses.filter((c) => c.status === "active" && c.attacker_team === teamId);

  if (onMe.length === 0 && byMe.length === 0 && !result) return null;

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

  // Curses on this team: one red sign each, with what to do to clear it.
  // Curses this team played: one orange sign listing them all.
  return (
    <section className="space-y-2">
      <Notice result={result} />

      {onMe.map((c) => {
        const asked = confirm?.id === c.id ? confirm.kind : null;
        return (
          <SignBox
            key={c.id}
            tone="red"
            title={
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="tc-label opacity-90">Cursed by {name(c.attacker_team)}</div>
                  <div className="text-lg leading-tight break-words">{c.card_name}</div>
                </div>
                <SpeedTag>+1×</SpeedTag>
              </div>
            }
          >
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="tc-label text-red-700">{c.clearance ? "To clear" : ""}</span>
                <span className="shrink-0 text-xs text-gray-500">since {clockTime(c.started_at)}</span>
              </div>
              {c.clearance && <p className="font-semibold">{c.clearance}</p>}
            </div>
            {asked ? (
              <div className="flex gap-2">
                <button
                  disabled={pending}
                  onClick={() => run(() => (asked === "clear" ? clearCurse(c.id) : vetoCurse(c.id)))}
                  className={`flex-1 p-2 font-bold text-white disabled:opacity-50 ${
                    asked === "clear" ? "bg-green-600" : "bg-red-600"
                  }`}
                >
                  {asked === "clear" ? "Yes, we did it" : "Yes, use Veto"}
                </button>
                <button onClick={() => setConfirm(null)} className="flex-1 border-2 border-gray-900 bg-white p-2 font-bold">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirm({ id: c.id, kind: "clear" })}
                  className="flex-1 bg-green-600 p-2 font-bold text-white"
                >
                  ✓ Task done
                </button>
                {hasVeto && (
                  <button
                    onClick={() => setConfirm({ id: c.id, kind: "veto" })}
                    className="flex-1 border-2 border-red-600 bg-white p-2 font-bold text-red-700"
                  >
                    Veto
                  </button>
                )}
              </div>
            )}
          </SignBox>
        );
      })}

      {byMe.length > 0 && (
        <SignBox
          tone="orange"
          title={
            <div className="flex items-center justify-between gap-2">
              <span>
                Your curses <span className="font-normal">({byMe.length})</span>
              </span>
              <SpeedTag>−{byMe.reduce((sum, c) => sum + c.attacker_gain, 0)}×</SpeedTag>
            </div>
          }
          bodyClassName="bg-white space-y-0! p-0!"
        >
          <ul className="divide-y divide-gray-200">
            {byMe.map((c) => (
              <li key={c.id} className="border-l-4 border-orange-600 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 font-bold break-words">
                    {c.card_name} <span className="font-normal text-gray-600">on</span> {name(c.target_team)}
                    {c.attacker_gain > 1 && (
                      <span className="ml-1 bg-orange-600 px-1 text-xs text-white">you gain {c.attacker_gain}×</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">since {clockTime(c.started_at)}</span>
                </div>
                {c.clearance && (
                  <p className="text-sm text-gray-600">
                    <span className="tc-label text-gray-500">They must:</span> {c.clearance}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </SignBox>
      )}

      {speedFix}
    </section>
  );
}

// A small square tag on a sign bar, e.g. "+1×".
function SpeedTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 border-2 border-white px-1.5 text-xs font-bold whitespace-nowrap tabular-nums">
      {children} speed
    </span>
  );
}

// "2:14 pm", in the phone's own time format.
function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
