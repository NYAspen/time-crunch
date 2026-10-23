"use client";

import { useLiveTable } from "@/components/useLiveTable";
import { loadActivityLog } from "@/lib/queries";

function describe(eventType: string, details: Record<string, unknown>) {
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
  return detailText ? `${eventType.replaceAll("_", " ")} (${detailText})` : eventType.replaceAll("_", " ");
}

export function ActivityLog() {
  const { data: entries, error } = useLiveTable("activity_log", loadActivityLog);

  return (
    <section className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-semibold">Activity log (latest 50)</h2>
      {error && <p className="text-red-700">Error: {error}</p>}
      {entries?.length === 0 && <p className="text-gray-500">Nothing yet.</p>}
      <ul className="space-y-1 text-sm">
        {entries?.map((entry) => (
          <li key={entry.id} className="flex gap-2">
            <span className="shrink-0 font-mono text-gray-500">
              {new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </span>
            <span>{describe(entry.event_type, entry.details)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
