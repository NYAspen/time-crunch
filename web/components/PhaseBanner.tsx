"use client";

import { loadGameState } from "@/lib/queries";
import { PHASE_LABELS, PHASE_SCHEDULE } from "@/lib/types";
import { useLiveTable } from "./useLiveTable";

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// One-line version for the team page header: "Current phase: Preparation" (+ a paused badge).
export function PhaseTag() {
  const { data: state } = useLiveTable("game_state", loadGameState);
  if (!state) return <span className="text-sm text-gray-400">Loading…</span>;

  return (
    <span className="tc-phase inline-flex flex-wrap items-center gap-2 rounded-md bg-blue-600 px-2.5 py-1 text-sm text-white">
      <span>
        <span className="opacity-80">Current phase:</span> <b>{PHASE_LABELS[state.phase]}</b>
      </span>
      {state.is_paused && (
        <span className="tc-paused bg-yellow-300 px-1.5 font-bold text-gray-900">
          ⏸ Paused{state.paused_at ? ` since ${formatTime(state.paused_at)}` : ""}
        </span>
      )}
    </span>
  );
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
      <div className="tc-phase tc-phase-big border-t-8 border-blue-600 bg-gray-900 p-4 text-white">
        <div className="text-sm uppercase tracking-wide opacity-80">Current phase</div>
        <div className="text-3xl font-bold">{PHASE_LABELS[state.phase]}</div>
        <div className="text-sm opacity-80">
          Scheduled {PHASE_SCHEDULE[state.phase]} · started {formatTime(state.phase_started_at)}
        </div>
      </div>
      {state.is_paused && (
        <div className="tc-paused border-2 border-gray-900 bg-yellow-300 p-4 text-center text-lg font-black tracking-wide text-gray-900 uppercase">
          ⏸ Game paused{state.paused_at ? ` since ${formatTime(state.paused_at)}` : ""}
        </div>
      )}
    </div>
  );
}
