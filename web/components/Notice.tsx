"use client";

import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/types";

const FADE_MS = 500;

// Shows the result of an action (green for success, red for an error).
// It fades out by itself after a few seconds (errors stay a bit longer) and
// can be closed with ×. A new result shows again even if the text is the same.
export function Notice({ result, compact }: { result: ActionResult; compact?: boolean }) {
  const [fading, setFading] = useState<ActionResult>(null);
  const [hidden, setHidden] = useState<ActionResult>(null);

  useEffect(() => {
    if (!result) return;
    const showFor = result.ok ? 5000 : 8000;
    const fadeTimer = setTimeout(() => setFading(result), showFor);
    const hideTimer = setTimeout(() => setHidden(result), showFor + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [result]);

  if (!result || hidden === result) return null;

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg transition-opacity duration-500 ${compact ? "p-2 text-sm" : "p-3"} ${
        fading === result ? "opacity-0" : "opacity-100"
      } ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
    >
      <span className="min-w-0 flex-1">{result.message}</span>
      <button
        type="button"
        aria-label="Close message"
        onClick={() => setHidden(result)}
        className="-my-1 shrink-0 px-1 text-lg leading-none opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
