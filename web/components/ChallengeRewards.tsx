import type { Challenge } from "@/lib/types";

// "draw 3 pick 1"; a single card goes straight into the hand, so it's just "draw 1 card".
export function drawLabel(cards: number, keep = 1) {
  return cards === 1 ? "draw 1 card" : `draw ${cards} pick ${keep}`;
}

export function ChallengeRewards({ challenge }: { challenge: Pick<Challenge, "reward_cards" | "reward_minutes"> }) {
  return (
    <div className="flex flex-wrap gap-1 text-sm">
      {challenge.reward_minutes > 0 && (
        <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">
          +{challenge.reward_minutes} min
        </span>
      )}
      {challenge.reward_cards > 0 && (
        <span className="rounded-full bg-purple-100 px-2 py-0.5 font-semibold text-purple-800">
          {drawLabel(challenge.reward_cards)}
        </span>
      )}
    </div>
  );
}
