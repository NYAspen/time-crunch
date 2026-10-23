import type { ReactNode } from "react";

// A card that opens and closes when its title is tapped.
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode; // short status shown next to the title, e.g. "10 / 10 on board"
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 select-none">
        <span>
          <span className="text-lg font-semibold">{title}</span>
          {summary && <span className="ml-2 text-sm text-gray-500">{summary}</span>}
        </span>
        <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}
