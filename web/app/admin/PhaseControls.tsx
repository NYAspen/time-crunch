"use client";

import { useState, useTransition } from "react";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadGameState } from "@/lib/queries";
import { PHASE_LABELS, PHASES, type ActionResult, type Phase } from "@/lib/types";
import { setPaused, setPhase } from "./actions";

export function PhaseControls() {
  const { data: state } = useLiveTable("game_state", loadGameState);
  const [confirming, setConfirming] = useState<Phase | null>(null);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  if (!state) return null;

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      setConfirming(null);
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-semibold">Game controls</h2>

      <button
        disabled={pending}
        onClick={() => run(() => setPaused(!state.is_paused))}
        className={`w-full rounded-xl p-4 text-lg font-bold disabled:opacity-50 ${
          state.is_paused ? "bg-green-600 text-white" : "bg-yellow-400 text-yellow-950"
        }`}
      >
        {state.is_paused ? "▶ Resume game" : "⏸ Pause game"}
      </button>

      <div className="text-sm text-gray-600">Switch phase (applies to every team at once):</div>
      <div className="grid grid-cols-2 gap-2">
        {PHASES.map((phase) => (
          <button
            key={phase}
            disabled={pending || phase === state.phase}
            onClick={() => setConfirming(phase)}
            className={`rounded-lg border p-3 disabled:opacity-40 ${
              phase === state.phase ? "border-blue-600 bg-blue-50 font-bold" : "bg-white"
            }`}
          >
            {PHASE_LABELS[phase]}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="space-y-2 rounded-lg bg-orange-100 p-3">
          <p className="font-medium text-orange-950">
            Switch ALL teams from {PHASE_LABELS[state.phase]} to {PHASE_LABELS[confirming]}?
          </p>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() => run(() => setPhase(confirming))}
              className="flex-1 rounded-lg bg-orange-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              Yes, switch
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="flex-1 rounded-lg border bg-white p-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className={`rounded-lg p-3 ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {result.message}
        </p>
      )}
    </section>
  );
}
