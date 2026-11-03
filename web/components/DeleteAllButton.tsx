"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { refreshAllLiveTables } from "./useLiveTable";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

// A red "Delete all …" button that asks for confirmation first.
export function DeleteAllButton({
  label,
  warning,
  action,
}: {
  label: string;
  warning: string;
  action: () => Promise<ActionResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {confirming ? (
        <SignBox tone="red" compact title="Are you sure?">
          <p>{warning}</p>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(await action());
                  setConfirming(false);
                  refreshAllLiveTables();
                })
              }
              className="flex-1 rounded bg-red-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Yes, {label.toLowerCase()}
            </button>
            <button onClick={() => setConfirming(false)} className="flex-1 rounded border bg-white p-2 text-sm">
              Cancel
            </button>
          </div>
        </SignBox>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full rounded border-2 border-red-600 bg-white p-2 text-sm font-bold text-red-700"
        >
          {label}
        </button>
      )}
      <Notice compact result={result} />
    </div>
  );
}
