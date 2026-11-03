import type { Challenge } from "@/lib/types";

// "draw 3 pick 1"; a single card goes straight into the hand, so it's just "draw 1 card".
export function drawLabel(cards: number, keep = 1) {
  return cards === 1 ? "draw 1 card" : `draw ${cards} pick ${keep}`;
}

// A sign-style tag: a coloured icon block on the left, then the label (like a
// transfer sign at an L station).
function RewardTag({ icon, iconClass, children }: { icon: React.ReactNode; iconClass: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-sm border-2 border-gray-900 bg-white text-xs font-bold uppercase tracking-wide text-gray-900">
      <span className={`flex items-center px-1.5 ${iconClass}`}>{icon}</span>
      <span className="px-2 py-1">{children}</span>
    </span>
  );
}

const ClockIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" strokeLinecap="square" />
  </svg>
);

const CardsIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="2" width="8" height="11" />
    <path d="M3 5v9h7" strokeLinecap="square" />
  </svg>
);

export function ChallengeRewards({ challenge }: { challenge: Pick<Challenge, "reward_cards" | "reward_minutes"> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {challenge.reward_minutes > 0 && (
        <RewardTag icon={ClockIcon} iconClass="bg-green-600 text-white">
          +{challenge.reward_minutes} min
        </RewardTag>
      )}
      {challenge.reward_cards > 0 && (
        <RewardTag icon={CardsIcon} iconClass="bg-purple-600 text-white">
          {drawLabel(challenge.reward_cards)}
        </RewardTag>
      )}
    </div>
  );
}
