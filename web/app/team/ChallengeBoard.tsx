"use client";

import { useState, useTransition } from "react";
import { ChallengeRewards } from "@/components/ChallengeRewards";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadChallenges, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, Challenge } from "@/lib/types";
import { claimChallenge } from "./actions";
import { Notice } from "@/components/Notice";

export function ChallengeBoard({ teamId }: { teamId: string }) {
  const { data: challenges, error } = useLiveTable("challenges", loadChallenges);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);

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

  return (
    <section className="space-y-3">

      <Notice result={result} />
      {game.is_paused && (
        <p className="text-sm text-gray-600">The game is paused. Claims open again when it resumes.</p>
      )}
      {active.length === 0 && <p className="text-gray-500">No challenges on the board right now.</p>}

      <ul className="space-y-2">
        {active.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            canClaim={canClaim}
            onClaimed={(r) => {
              setResult(r);
              refreshAllLiveTables();
            }}
          />
        ))}
      </ul>

      {claimed.length > 0 && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="font-semibold">Claimed challenges ({claimed.length})</summary>
          <ul className="mt-2 divide-y text-sm">
            {claimed.map((c) => (
              <li key={c.id} className="py-2">
                <b>{c.title}</b> — claimed by {c.claimed_by === teamId ? "your team" : teamName(c.claimed_by)}
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
  onClaimed,
}: {
  challenge: Challenge;
  canClaim: boolean;
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
    <li className="space-y-2 rounded-xl border bg-white p-4">
      <div className="text-lg font-semibold">{challenge.title}</div>
      {challenge.task && <p className="whitespace-pre-line text-gray-700">{challenge.task}</p>}
      <ChallengeRewards challenge={challenge} />

      {confirming ? (
        <div className="space-y-2 rounded-lg bg-orange-100 p-3">
          <p className="font-medium text-orange-950">Did your team complete this challenge?</p>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={claim}
              className="flex-1 rounded-lg bg-orange-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Claiming…" : "Yes, claim it"}
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-lg border bg-white p-3"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          disabled={!canClaim}
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg bg-blue-600 p-3 font-semibold text-white disabled:opacity-40"
        >
          Claim
        </button>
      )}
    </li>
  );
}
