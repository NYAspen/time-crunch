"use client";

import { useState, useTransition } from "react";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadGameState } from "@/lib/queries";
import { PHASE_LABELS, PHASES, type ActionResult, type Phase } from "@/lib/types";
import { setPaused, setPhase } from "./adminActions";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

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
    <SignBox tone="black" title={<h2 className="text-lg">Game controls</h2>}>

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
              phase === state.phase ? "border-blue-600 bg-blue-600 font-bold text-white disabled:opacity-100" : "bg-white"
            }`}
          >
            {PHASE_LABELS[phase]}
          </button>
        ))}
      </div>

      {confirming && (
        <SignBox tone="orange" title={`Switch ALL teams from ${PHASE_LABELS[state.phase]} to ${PHASE_LABELS[confirming]}?`}>
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
        </SignBox>
      )}

      <Notice result={result} />
    </SignBox>
  );
}
