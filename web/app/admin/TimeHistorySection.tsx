"use client";

import { useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Notice } from "@/components/Notice";
import { TimeHistory } from "@/components/TimeHistory";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadLedger, loadTeams } from "@/lib/queries";
import type { ActionResult } from "@/lib/types";
import { undoTimeEntry } from "./actions";

// Every team's time changes, newest first, with Undo.
export function TimeHistorySection() {
  const { data: ledger } = useLiveTable("time_ledger", loadLedger);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [undoResult, setUndoResult] = useState<ActionResult>(null);
  const [undoing, startUndo] = useTransition();

  const teamNames = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <CollapsibleSection title="Time history" summary="newest first">
      <Notice compact result={undoResult} />
      {ledger && (
        <TimeHistory
          entries={ledger}
          teamNames={teamNames}
          undoDisabled={undoing}
          onUndo={(entry) =>
            startUndo(async () => {
              setUndoResult(await undoTimeEntry(entry.id));
              refreshAllLiveTables();
            })
          }
        />
      )}
    </CollapsibleSection>
  );
}
