import { CARD_TYPE_LABELS, type CardType } from "@/lib/types";

// Each card looks like a station sign: a coloured bar with the card's name
// (red for curses, blue for power-ups), then its text on a white panel.
const EDGE_STYLES: Record<CardType["type"], string> = {
  curse: "border-red-600",
  powerup: "border-blue-600",
};

const BAR_STYLES: Record<CardType["type"], string> = {
  curse: "bg-red-600",
  powerup: "bg-blue-600",
};

const BADGE_STYLES: Record<CardType["type"], string> = {
  curse: "text-red-700",
  powerup: "text-blue-700",
};

// Shows a card's text. `children` holds the buttons for that situation.
// `compact` is a smaller card, used two to a row when picking from a draw.
export function CardView({
  cardType,
  isDuplicate,
  compact,
  children,
}: {
  cardType: CardType;
  isDuplicate?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  // Curses lead with what the victim must do to clear them; their description
  // (the speed effect, the same on every curse) is left off the card.
  const isCurse = cardType.type === "curse";
  const body = isCurse ? cardType.clearance : cardType.description;
  const rows = [
    { label: "Range", value: cardType.range_text },
    ...(isCurse ? [] : [{ label: "To clear", value: cardType.clearance }]),
  ].filter((r) => r.value);

  return (
    // Thick edge and a drop shadow so the card stands off the grey page.
    <div
      data-type={cardType.type}
      className={`flex h-full flex-col overflow-hidden border-[3px] bg-white shadow-[0_3px_8px_rgb(0_0_0/0.22)] ${
        EDGE_STYLES[cardType.type]
      }`}
    >
      <div
        className={`flex justify-between gap-2 text-white ${BAR_STYLES[cardType.type]} ${
          compact ? "flex-col px-2 py-1.5" : "items-center px-3 py-2"
        }`}
      >
        <span className={`leading-tight font-black tracking-tight ${compact ? "text-base" : "text-lg"}`}>{cardType.name}</span>
        <span className="flex shrink-0 gap-1 text-xs font-bold tracking-wide uppercase">
          {isDuplicate && <span className="border border-white/70 px-1.5">Copy</span>}
          <span className={`bg-white px-1.5 ${BADGE_STYLES[cardType.type]}`}>{CARD_TYPE_LABELS[cardType.type]}</span>
        </span>
      </div>
      <div className={`flex flex-1 flex-col ${compact ? "gap-1.5 p-2 text-sm" : "gap-2 p-3"}`}>
        {body && (
          <div>
            {isCurse && <div className="text-xs font-bold tracking-wide text-gray-500 uppercase">To clear</div>}
            <p className="whitespace-pre-line">{body}</p>
          </div>
        )}
        {rows.length > 0 && (
          <dl className={`divide-y border-y border-gray-200 ${compact ? "text-xs" : "text-sm"}`}>
            {rows.map((r) => (
              // Compact cards are narrow, so the label sits above its value.
              <div key={r.label} className={compact ? "py-1" : "flex gap-3 py-1.5"}>
                <dt
                  className={`shrink-0 text-xs font-bold tracking-wide text-gray-500 uppercase ${compact ? "" : "w-16 pt-0.5"}`}
                >
                  {r.label}
                </dt>
                <dd className="min-w-0 flex-1">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {/* Buttons sit at the bottom, so they line up across a row of cards. */}
        {children && <div className="mt-auto">{children}</div>}
      </div>
    </div>
  );
}
