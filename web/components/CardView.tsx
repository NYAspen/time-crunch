import { CARD_TYPE_LABELS, type CardType } from "@/lib/types";

const TYPE_STYLES: Record<CardType["type"], string> = {
  curse: "border-red-300 bg-red-50",
  powerup: "border-blue-300 bg-blue-50",
};

const BADGE_STYLES: Record<CardType["type"], string> = {
  curse: "bg-red-200 text-red-900",
  powerup: "bg-blue-200 text-blue-900",
};

// Shows a card's text. `children` holds the buttons for that situation.
export function CardView({
  cardType,
  isDuplicate,
  children,
}: {
  cardType: CardType;
  isDuplicate?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 rounded-xl border-2 p-3 ${TYPE_STYLES[cardType.type]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{cardType.name}</span>
        <span className="flex shrink-0 gap-1">
          {isDuplicate && <span className="rounded bg-gray-200 px-1.5 text-xs text-gray-700">copy</span>}
          <span className={`rounded px-1.5 text-xs font-semibold ${BADGE_STYLES[cardType.type]}`}>
            {CARD_TYPE_LABELS[cardType.type]}
          </span>
        </span>
      </div>
      {cardType.description && <p className="whitespace-pre-line text-sm">{cardType.description}</p>}
      {cardType.range_text && (
        <p className="text-sm">
          <b>Range:</b> {cardType.range_text}
        </p>
      )}
      {cardType.clearance && (
        <p className="text-sm">
          <b>To clear:</b> {cardType.clearance}
        </p>
      )}
      {children}
    </div>
  );
}
