"use client";

import { loadGameState } from "@/lib/queries";
import { PHASE_LABELS, PHASE_SCHEDULE } from "@/lib/types";
import { useLiveTable } from "./useLiveTable";

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function PhaseBanner() {
  const { data: state, error } = useLiveTable("game_state", loadGameState);

  if (error) {
    return <div className="rounded-xl bg-red-100 p-4 text-red-800">Error: {error}</div>;
  }
  if (!state) {
    return <div className="rounded-xl bg-gray-100 p-4 text-gray-500">Loading game state…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-blue-600 p-4 text-white">
        <div className="text-sm uppercase tracking-wide opacity-80">Current phase</div>
        <div className="text-3xl font-bold">{PHASE_LABELS[state.phase]}</div>
        <div className="text-sm opacity-80">
          Scheduled {PHASE_SCHEDULE[state.phase]} · started {formatTime(state.phase_started_at)}
        </div>
      </div>
      {state.is_paused && (
        <div className="rounded-xl bg-yellow-300 p-4 text-center text-lg font-bold text-yellow-950">
          ⏸ Game paused{state.paused_at ? ` since ${formatTime(state.paused_at)}` : ""}
        </div>
      )}
    </div>
  );
}
