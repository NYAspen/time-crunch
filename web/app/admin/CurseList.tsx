"use client";

import { useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCurses, loadTeams } from "@/lib/queries";
import type { ActionResult } from "@/lib/types";
import { adminClearCurse } from "./adminActions";
import { Notice } from "@/components/Notice";

export function CurseList() {
  const { data: curses } = useLiveTable("curses", loadCurses);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!curses || !teams) return null;
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "?";
  const speed = (id: string) => teams.find((t) => t.id === id)?.speed;
  const active = curses.filter((c) => c.status === "active");

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
              Speeds: target {speed(c.target_team)}× (should be 2×) · attacker {speed(c.attacker_team)}× (should be 0×)
            </div>
            {confirming === c.id ? (
              <div className="flex gap-2">
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setResult(await adminClearCurse(c.id));
                      setConfirming(null);
                      refreshAllLiveTables();
                    })
                  }
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
