"use client";

import { useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCurses, loadTeams } from "@/lib/queries";
import { curseSpeed } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { adminClearCurse, syncTeamSpeed } from "./adminActions";
import { Notice } from "@/components/Notice";

export function CurseList() {
  const { data: curses } = useLiveTable("curses", loadCurses);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!curses || !teams) return null;
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "?";
  const active = curses.filter((c) => c.status === "active");

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      setConfirming(null);
      refreshAllLiveTables();
    });

  // Each curse shifts speeds by 1, so a team's speed should be
  // 1 + curses on it - curses it played. Offer a fix if it isn't.
  const speedInfo = (role: string, id: string) => {
    const actual = teams.find((t) => t.id === id)?.speed;
    const expected = curseSpeed(id, active);
    return (
      <span>
        {role} {actual}×
        {actual !== expected && (
          <>
            {" "}
            <b className="text-red-700">(should be {expected}×)</b>{" "}
            <button
              disabled={pending}
              onClick={() => run(() => syncTeamSpeed(id))}
              className="rounded border bg-white px-1.5 text-xs disabled:opacity-50"
            >
              Fix
            </button>
          </>
        )}
      </span>
    );
  };

  return (
    <CollapsibleSection title="Curses" summary={`${active.length} active`} defaultOpen>
      {active.length === 0 && <p className="text-sm text-gray-500">No active curses.</p>}
      <ul className="space-y-2">
        {active.map((c) => (
          <li key={c.id} className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
            <div>
              <b>{name(c.attacker_team)}</b> → <b>{name(c.target_team)}</b>: {c.card_name}, since{" "}
              {new Date(c.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
            <div className="text-gray-600">
              Speeds: {speedInfo("target", c.target_team)} · {speedInfo("attacker", c.attacker_team)}
            </div>
            {confirming === c.id ? (
              <div className="flex gap-2">
                <button
                  disabled={pending}
                  onClick={() => run(() => adminClearCurse(c.id))}
                  className="flex-1 rounded bg-red-600 p-2 font-semibold text-white disabled:opacity-50"
                >
                  Yes, clear it
                </button>
                <button onClick={() => setConfirming(null)} className="flex-1 rounded border bg-white p-2">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirming(c.id)} className="rounded border bg-white px-2 py-1">
                Clear curse
              </button>
            )}
          </li>
        ))}
      </ul>
      <Notice compact result={result} />
    </CollapsibleSection>
  );
}
