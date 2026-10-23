"use client";

import { formatClock, formatDelta } from "@/lib/time";
import type { LedgerEntry } from "@/lib/types";

function describe(entry: LedgerEntry) {
  switch (entry.kind) {
    case "speed":
      return `Speed ${entry.details.from}× → ${entry.details.to}×${entry.reason ? ` (${entry.reason})` : ""}`;
    case "eliminated":
      return `Eliminated${entry.reason ? ` (${entry.reason})` : ""}`;
    case "revived":
      return "Back in the game (admin)";
    default:
      return `${formatDelta(entry.delta_ms)}${entry.reason ? ` · ${entry.reason}` : ""}`;
  }
}

type Props = {
  entries: LedgerEntry[];
  teamNames?: Record<string, string>; // admin view: show which team
  onUndo?: (entry: LedgerEntry) => void; // admin view: allow undo
  undoDisabled?: boolean;
};

export function TimeHistory({ entries, teamNames, onUndo, undoDisabled }: Props) {
  if (entries.length === 0) return <p className="text-gray-500">No time changes yet.</p>;

  return (
    <ul className="divide-y text-sm">
      {entries.map((entry) => {
        const canUndo = onUndo && entry.delta_ms !== 0 && entry.kind !== "reversal" && entry.reversed_by === null;
        return (
          <li key={entry.id} className="flex items-center gap-2 py-2">
            <span className="shrink-0 font-mono text-gray-500">
              {new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className={`min-w-0 flex-1 ${entry.reversed_by ? "text-gray-400 line-through" : ""}`}>
              {teamNames && <b>{teamNames[entry.team_id] ?? "?"}: </b>}
              {describe(entry)}
              <span className="text-gray-400"> · bal {formatClock(entry.balance_after_ms)}</span>
            </span>
            {canUndo && (
              <button
                disabled={undoDisabled}
                onClick={() => onUndo(entry)}
                className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-50"
              >
                Undo
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
