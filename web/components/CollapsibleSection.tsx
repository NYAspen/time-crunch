import type { ReactNode } from "react";

// A card that opens and closes when its title is tapped.
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  danger = false,
  children,
}: {
  title: string;
  summary?: ReactNode; // short status shown next to the title, e.g. "10 / 10 on board"
  defaultOpen?: boolean;
  danger?: boolean; // red styling for destructive sections such as Reset game
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-xl border ${danger ? "border-red-300 bg-red-50" : "bg-white"}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 select-none">
        <span>
          <span className={`text-lg font-semibold ${danger ? "text-red-700" : ""}`}>{title}</span>
          {summary && <span className="ml-2 text-sm text-gray-500">{summary}</span>}
        </span>
        <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}
