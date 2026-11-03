"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Notice";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadUndos } from "@/lib/queries";
import type { ActionResult } from "@/lib/types";
import { undoAction } from "./gameActions";

// For 60 seconds after a claim, card use, discard or curse clear, the team can
// undo it. The database decides whether it is still allowed.
export function UndoBar({ teamId }: { teamId: string }) {
  const { data: undos } = useLiveTable("team_undos", loadUndos);
  const serverNow = useServerNow(1000);
  const [result, setResult] = useState<ActionResult>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const open =
    undos && serverNow !== null
      ? undos.filter(
          (u) => u.team_id === teamId && !closed.includes(u.id) && new Date(u.expires_at).getTime() > serverNow,
        )
      : [];
  if (open.length === 0 && !result) return null;

  const undo = (id: string) =>
    startTransition(async () => {
      setResult(await undoAction(id));
      refreshAllLiveTables();
    });

  // Pinned to the bottom of the screen so it is visible wherever the team
  // tapped; the spacer stops it covering the end of the page.
  return (
    <>
      {open.length > 0 && <div className="h-24" aria-hidden />}
      <section
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg space-y-2 px-4"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <Notice result={result} />
        {open.map((u) => {
          const secondsLeft = Math.ceil((new Date(u.expires_at).getTime() - serverNow!) / 1000);
          return (
            <div
              key={u.id}
              className="flex items-stretch overflow-hidden border-2 border-gray-900 bg-white shadow-lg"
            >
              <span aria-hidden className="flex w-10 shrink-0 items-center justify-center bg-gray-900 text-xl text-white">
                ↶
              </span>
              <span className="min-w-0 flex-1 self-center py-2 pl-1 text-sm">
                <b>{u.label}</b>
                <span className="block text-xs text-gray-600">Mistake? You can undo for {secondsLeft} s.</span>
              </span>
              <button
                disabled={pending}
                onClick={() => undo(u.id)}
                className="my-2 bg-blue-600 px-4 font-bold text-white disabled:opacity-50"
              >
                Undo
              </button>
              <button
                onClick={() => setClosed([...closed, u.id])}
                aria-label="Close"
                className="px-3 text-xl leading-none text-gray-500"
              >
                ×
              </button>
            </div>
          );
        })}
      </section>
    </>
  );
}
