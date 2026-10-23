"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useLiveTable } from "@/components/useLiveTable";
import { loadActivityLog } from "@/lib/queries";

const PAGE_SIZE = 15;

function describe(eventType: string, details: Record<string, unknown>) {
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
  return detailText ? `${eventType.replaceAll("_", " ")} (${detailText})` : eventType.replaceAll("_", " ");
}

export function ActivityLog() {
  const { data: entries, error } = useLiveTable("activity_log", loadActivityLog);
  const [shown, setShown] = useState(PAGE_SIZE);

  return (
    <CollapsibleSection title="Activity log" summary="newest first">
      {error && <p className="text-red-700">Error: {error}</p>}
      {entries?.length === 0 && <p className="text-gray-500">Nothing yet.</p>}
      <ul className="space-y-1 text-sm">
        {entries?.slice(0, shown).map((entry) => (
          <li key={entry.id} className="flex gap-2">
            <span className="shrink-0 font-mono text-gray-500">
              {new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </span>
            <span>{describe(entry.event_type, entry.details)}</span>
          </li>
        ))}
      </ul>
      {entries && entries.length > shown && (
        <button onClick={() => setShown(shown + PAGE_SIZE)} className="w-full rounded border p-2 text-sm text-gray-600">
          Show more
        </button>
      )}
    </CollapsibleSection>
  );
}
