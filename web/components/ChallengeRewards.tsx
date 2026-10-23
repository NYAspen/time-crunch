import type { Challenge } from "@/lib/types";

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
          draw {challenge.reward_cards} card{challenge.reward_cards === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
