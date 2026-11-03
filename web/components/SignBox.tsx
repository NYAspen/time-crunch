import type { ReactNode } from "react";

// The design's standard alert / prompt box, styled like a station sign: a
// coloured heading bar, then a white panel with a matching border. Use it for
// anything that needs attention (curses, confirmations, warnings, notes)
// instead of pale tinted boxes.
//   red     curses, steals, destructive confirmations
//   orange  "are you sure?" confirmations
//   purple  card draws
//   yellow  paused / notes
//   green   good news (a curse you can clear)
//   black   neutral
export type SignTone = "red" | "orange" | "purple" | "yellow" | "green" | "black";

const EDGE: Record<SignTone, string> = {
  red: "border-red-600",
  orange: "border-orange-600",
  purple: "border-purple-600",
  yellow: "border-yellow-300",
  green: "border-green-600",
  black: "border-gray-900",
};

const BAR: Record<SignTone, string> = {
  red: "bg-red-600 text-white",
  orange: "bg-orange-600 text-white",
  purple: "bg-purple-600 text-white",
  yellow: "bg-yellow-300 text-gray-900",
  green: "bg-green-600 text-white",
  black: "bg-gray-900 text-white",
};

export function SignBox({
  tone,
  title,
  compact,
  bodyClassName = "bg-white",
  children,
}: {
  tone: SignTone;
  title: ReactNode;
  compact?: boolean; // smaller, for notes inside admin sections
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`overflow-hidden border-2 ${EDGE[tone]}`}>
      <div className={`font-bold ${BAR[tone]} ${compact ? "px-2 py-1 text-sm" : "px-3 py-2"}`}>{title}</div>
      {children && (
        <div className={`space-y-2 ${compact ? "p-2 text-sm" : "p-3"} ${bodyClassName}`}>{children}</div>
      )}
    </div>
  );
}
