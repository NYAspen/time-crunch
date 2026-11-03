"use client";

import { useState, useTransition } from "react";
import { ChallengeLocation, ChallengeRewards } from "@/components/ChallengeRewards";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadChallenges, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, Challenge } from "@/lib/types";
import { claimChallenge } from "./gameActions";
import { showResult } from "@/components/Toasts";
import { SignBox } from "@/components/SignBox";

export function ChallengeBoard({ teamId }: { teamId: string }) {
  const { data: challenges, error } = useLiveTable("challenges", loadChallenges);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);

  if (error) return <p className="text-red-700">Error loading challenges: {error}</p>;
  if (!challenges || !game || !teams) return <p className="text-gray-500">Loading challenges…</p>;

  const me = teams.find((t) => t.id === teamId);
  const canClaim = !game.is_paused && me?.status === "active";
  const active = challenges
    .filter((c) => c.status === "active")
    .sort((a, b) => (a.activated_at ?? "").localeCompare(b.activated_at ?? ""));
  const claimed = challenges
    .filter((c) => c.status === "claimed")
    .sort((a, b) => (b.claimed_at ?? "").localeCompare(a.claimed_at ?? ""));
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "a team";
  const multiplier = me?.reward_multiplier ?? 1;

  return (
    <section className="space-y-3">
      {game.is_paused && (
        <p className="text-sm text-gray-600">The game is paused. Challenges can be completed again when it resumes.</p>
      )}
      {multiplier > 1 && (
        <SignBox tone="green" title={`Your next challenge is worth ×${multiplier}`}>
          <p className="text-sm">
            The next challenge you complete gives {multiplier}× the time bonus and {multiplier}× the card draws.
          </p>
        </SignBox>
      )}
      {active.length === 0 && <p className="text-gray-500">No challenges on the board right now.</p>}

      <ul className="tc-stops space-y-2">
        {active.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            canClaim={canClaim && (!challenge.locked_by || challenge.locked_by === teamId)}
            lockedBy={
              challenge.locked_by
                ? challenge.locked_by === teamId
                  ? "your team"
                  : teamName(challenge.locked_by)
                : null
            }
            onClaimed={(r) => {
              // A completion can be undone, so its result shows in the Undo bar.
              showResult(r, { undoable: true });
              refreshAllLiveTables();
            }}
          />
        ))}
      </ul>

      {claimed.length > 0 && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="font-semibold">Completed challenges ({claimed.length})</summary>
          <ul className="mt-2 divide-y text-sm">
            {claimed.map((c) => (
              <li key={c.id} className="py-2">
                <b>{c.title}</b> — completed by {c.claimed_by === teamId ? "your team" : teamName(c.claimed_by)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ChallengeCard({
  challenge,
  canClaim,
  lockedBy,
  onClaimed,
}: {
  challenge: Challenge;
  canClaim: boolean;
  lockedBy: string | null; // "lock challenge": only that team can complete it
  onClaimed: (result: ActionResult) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const claim = () =>
    startTransition(async () => {
      const result = await claimChallenge(challenge.id);
      setConfirming(false);
      onClaimed(result);
    });

  return (
    <li className="tc-challenge space-y-2 rounded-xl border bg-white p-4">
      <div className="text-lg font-semibold">{challenge.title}</div>
      {lockedBy && (
        <p className="inline-block border-2 border-gray-900 bg-yellow-300 px-2 py-0.5 text-xs font-bold tracking-wide uppercase">
          🔒 Locked by {lockedBy}
        </p>
      )}
      <ChallengeLocation location={challenge.location} />
      {challenge.task && <p className="whitespace-pre-line text-gray-700">{challenge.task}</p>}
      <ChallengeRewards challenge={challenge} />

      {confirming ? (
        <SignBox tone="orange" title="Did your team complete this challenge?">
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={claim}
              className="flex-1 rounded-lg bg-orange-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Yes, we completed it"}
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-lg border bg-white p-3"
            >
              Cancel
            </button>
          </div>
        </SignBox>
      ) : (
        <button
          disabled={!canClaim}
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg bg-blue-600 p-3 font-semibold text-white disabled:opacity-40"
        >
          Completed
        </button>
      )}
    </li>
  );
}
