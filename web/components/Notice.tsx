"use client";

import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/types";

const FADE_MS = 500;

// Shows the result of an action, styled like a station service-alert sign:
// a coloured icon block (green tick for success, red ! for an error), a short
// heading, then the message.
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
      className={`flex items-stretch overflow-hidden border-2 bg-white text-gray-900 transition-opacity duration-500 ${
        compact ? "text-sm" : ""
      } ${fading === result ? "opacity-0" : "opacity-100"} ${result.ok ? "border-green-600" : "border-red-600"}`}
    >
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center font-black text-white ${
          compact ? "w-7 text-base" : "w-10 text-xl"
        } ${result.ok ? "bg-green-600" : "bg-red-600"}`}
      >
        {result.ok ? "✓" : "!"}
      </span>
      <span className={`min-w-0 flex-1 ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
        {!compact && (
          <span
            className={`block text-xs font-bold uppercase tracking-wider ${result.ok ? "text-green-700" : "text-red-700"}`}
          >
            {result.ok ? "Done" : "Problem"}
          </span>
        )}
        {result.message}
      </span>
      <button
        type="button"
        aria-label="Close message"
        onClick={() => setHidden(result)}
        className="shrink-0 px-3 text-xl leading-none text-gray-500 hover:text-gray-900"
      >
        ×
      </button>
    </div>
  );
}
