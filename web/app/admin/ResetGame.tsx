"use client";

import { useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { refreshAllLiveTables } from "@/components/useLiveTable";
import type { ActionResult } from "@/lib/types";
import { resetGame } from "./actions";

export function ResetGame() {
  const [deleteTeams, setDeleteTeams] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  return (
    <CollapsibleSection title="Reset game">
      <p className="text-sm text-gray-700">
        Starts a fresh game. Clears all time, time history, claims, hands, draws, curses and the activity log. Every
        challenge and card goes back into the pool and deck, and the game returns to <b>Preparation</b>, unpaused, with
        0 time for everyone. Challenge and card content is kept.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={deleteTeams}
          onChange={(e) => setDeleteTeams(e.target.checked)}
          className="mt-1"
        />
        <span>
          Also delete <b>all teams and their logins</b> (for a new season or a new group of players).
        </span>
      </label>
      <label className="block text-sm">
        Type <b>RESET</b> to confirm:
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded border p-2" />
      </label>
      <button
        disabled={pending || typed !== "RESET"}
        onClick={() =>
          startTransition(async () => {
            setResult(await resetGame(deleteTeams));
            setTyped("");
            refreshAllLiveTables();
          })
        }
        className="w-full rounded-lg bg-red-600 p-3 font-semibold text-white disabled:opacity-40"
      >
        {pending ? "Resetting…" : "Reset game"}
      </button>
      {result && (
        <p
          className={`rounded-lg p-2 text-sm ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
        >
          {result.message}
        </p>
      )}
    </CollapsibleSection>
  );
}
