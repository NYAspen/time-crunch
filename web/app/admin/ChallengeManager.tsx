"use client";

import { useActionState, useState, useTransition } from "react";
import { ChallengeLocation, ChallengeRewards } from "@/components/ChallengeRewards";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { DeleteAllButton } from "@/components/DeleteAllButton";
import { ImportTable } from "@/components/ImportTable";
import { refreshAllLiveTables, useLiveTable, withRefresh } from "@/components/useLiveTable";
import { loadChallenges, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, Challenge } from "@/lib/types";
import {
  deleteAllChallenges,
  importChallenges,
  setBoardSize,
  setChallengeStatus,
  undoClaim,
  updateChallenge,
} from "./adminActions";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

const EXAMPLE =
  "title\ttask\tlocation\treward_cards\treward_keep\treward_minutes\nBean selfie\tTeam photo reflected in Cloud Gate\tMillennium Park\t4\t2\t15";

export function ChallengeManager() {
  const { data: challenges, error } = useLiveTable("challenges", loadChallenges);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [sizeResult, sizeAction, sizing] = useActionState(withRefresh(setBoardSize), null);
  const [importResult, importAction, importing] = useActionState(withRefresh(importChallenges), null);

  if (error) return <p className="text-red-700">Error: {error}</p>;
  if (!challenges || !game || !teams) return <p className="text-gray-500">Loading challenges…</p>;

  const byStatus = (status: Challenge["status"]) => challenges.filter((c) => c.status === status);
  const active = byStatus("active");
  const pool = byStatus("pool");
  const claimed = byStatus("claimed").sort((a, b) => (b.claimed_at ?? "").localeCompare(a.claimed_at ?? ""));
  const retired = byStatus("retired");
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "deleted team";

  return (
    <CollapsibleSection
      title="Challenges"
      summary={`${active.length}/${game.board_size} on board · ${pool.length} in pool`}
    >
      <div className="text-sm text-gray-700">
        On board: <b>{active.length}</b> / {game.board_size} · Unused pool: <b>{pool.length}</b> · Claimed:{" "}
        <b>{claimed.length}</b>
      </div>
      {active.length < game.board_size && (
        <SignBox tone="yellow" compact title="Note">
          <p>The pool has run out, so the board isn&apos;t full. Import more challenges.</p>
        </SignBox>
      )}

      <form action={sizeAction} className="flex items-center gap-2">
        <label className="text-sm">Challenges on board:</label>
        <input
          key={game.board_size}
          name="size"
          type="number"
          min={1}
          max={50}
          defaultValue={game.board_size}
          className="w-20 rounded border p-2"
        />
        <button disabled={sizing} className="rounded bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-50">
          Set
        </button>
      </form>
      <Notice compact result={sizeResult} />

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Import challenges</summary>
        <form action={importAction} className="mt-2 space-y-2">
          <ImportTable placeholder={EXAMPLE} />
          <button
            disabled={importing}
            className="w-full rounded bg-blue-600 p-2 font-semibold text-white disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <Notice compact result={importResult} />
        </form>
      </details>

      <ChallengeGroup
        title="On the board"
        challenges={active}
        onChanged={refreshAllLiveTables}
        poolEmpty={pool.length === 0}
      />
      <ChallengeGroup
        title="Unused pool (hidden from teams)"
        challenges={pool}
        onChanged={refreshAllLiveTables}
        collapsed
      />
      <ChallengeGroup title="Removed" challenges={retired} onChanged={refreshAllLiveTables} collapsed />

      {claimed.length > 0 && (
        <details>
          <summary className="font-medium">Claimed ({claimed.length})</summary>
          <ul className="mt-2 divide-y text-sm">
            {claimed.map((c) => (
              <ClaimedRow key={c.id} challenge={c} teamName={teamName(c.claimed_by)} />
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">
            Undo claim puts the challenge back on the board, takes back its time bonus and cancels its card draw if
            the team hasn&apos;t drawn it yet.
          </p>
        </details>
      )}
      <DeleteAllButton
        label="Delete all challenges"
        warning="This permanently deletes every challenge: on the board, in the pool and claimed. Time bonuses already given are kept. Use this before importing a new challenge list."
        action={deleteAllChallenges}
      />
    </CollapsibleSection>
  );
}

function ChallengeGroup({
  title,
  challenges,
  onChanged,
  collapsed,
  poolEmpty,
}: {
  title: string;
  challenges: Challenge[];
  onChanged: () => void;
  collapsed?: boolean;
  poolEmpty?: boolean; // nothing left to replace a board challenge with
}) {
  const list = (
    <ul className="mt-2 space-y-2">
      {challenges.length === 0 && <li className="text-sm text-gray-500">None.</li>}
      {challenges.map((c) => (
        <ChallengeRow key={c.id} challenge={c} onChanged={onChanged} poolEmpty={poolEmpty} />
      ))}
    </ul>
  );

  return collapsed ? (
    <details>
      <summary className="font-medium">
        {title} ({challenges.length})
      </summary>
      {list}
    </details>
  ) : (
    <div>
      <div className="font-medium">
        {title} ({challenges.length})
      </div>
      {list}
    </div>
  );
}

function ChallengeRow({
  challenge,
  onChanged,
  poolEmpty,
}: {
  challenge: Challenge;
  onChanged: () => void;
  poolEmpty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (r?.ok) setEditing(false);
      onChanged();
    });

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-extrabold">{challenge.title}</div>
          {/* "lock challenge": only one team can complete it. Removing it from the board unlocks it. */}
          {challenge.locked_by && <div className="text-xs font-bold uppercase">🔒 Locked by a team</div>}
          <ChallengeLocation location={challenge.location} />
          {challenge.task && <div className="text-sm text-gray-600">{challenge.task}</div>}
          <ChallengeRewards challenge={challenge} />
        </div>
        <div className="flex shrink-0 gap-2">
          {challenge.status === "active" && (
            <button
              disabled={poolEmpty}
              onClick={() => setConfirmReplace(true)}
              className="rounded border px-2 py-1 text-sm disabled:opacity-40"
            >
              Replace
            </button>
          )}
          <button onClick={() => setEditing(!editing)} className="rounded border px-2 py-1 text-sm">
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {confirmReplace && (
        <div className="space-y-2">
          <p className="text-sm">
            A random challenge from the pool takes its place. This one moves to Removed, where you can restore it to
            the pool.
            {challenge.locked_by && " The team that locked it loses the lock."}
          </p>
          <div className="flex gap-2">
            <button
              disabled={pending || poolEmpty}
              onClick={() => {
                setConfirmReplace(false);
                run(() => setChallengeStatus(challenge.id, "retired"));
              }}
              className="flex-1 rounded bg-gray-800 p-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Yes, replace it
            </button>
            <button onClick={() => setConfirmReplace(false)} className="flex-1 rounded border p-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <form action={(fd) => run(() => updateChallenge(challenge.id, fd))} className="space-y-2">
            <input
              name="title"
              defaultValue={challenge.title}
              required
              maxLength={100}
              className="w-full rounded border p-2"
            />
            <textarea name="task" defaultValue={challenge.task} rows={3} className="w-full rounded border p-2" />
            <input
              name="location"
              defaultValue={challenge.location}
              placeholder="Location (blank = anywhere)"
              className="w-full rounded border p-2"
            />
            <div className="flex gap-2">
              <label className="flex-1 text-sm">
                Cards to draw
                <input
                  name="reward_cards"
                  type="number"
                  min={0}
                  max={10}
                  defaultValue={challenge.reward_cards}
                  className="w-full rounded border p-2"
                />
              </label>
              <label className="flex-1 text-sm">
                Cards kept
                <input
                  name="reward_keep"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={challenge.reward_keep}
                  className="w-full rounded border p-2"
                />
              </label>
              <label className="flex-1 text-sm">
                Time bonus (min)
                <input
                  name="reward_minutes"
                  type="number"
                  min={0}
                  max={600}
                  defaultValue={challenge.reward_minutes}
                  className="w-full rounded border p-2"
                />
              </label>
            </div>
            <button
              disabled={pending}
              className="w-full rounded bg-gray-800 p-2 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
          </form>
          {challenge.status === "retired" ? (
            <button
              disabled={pending}
              onClick={() => run(() => setChallengeStatus(challenge.id, "pool"))}
              className="w-full rounded border p-2 text-sm"
            >
              Restore to pool
            </button>
          ) : (
            <button
              disabled={pending}
              onClick={() => run(() => setChallengeStatus(challenge.id, "retired"))}
              className="w-full rounded border border-red-300 p-2 text-sm text-red-700"
            >
              Remove{challenge.status === "active" ? " from board (replaced at random)" : ""}
            </button>
          )}
        </div>
      )}
      <Notice compact result={result} />
    </li>
  );
}

function ClaimedRow({ challenge, teamName }: { challenge: Challenge; teamName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const undo = () =>
    startTransition(async () => {
      setResult(await undoClaim(challenge.id));
      setConfirming(false);
      refreshAllLiveTables();
    });

  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <b>{challenge.title}</b> — {teamName}
          {challenge.claimed_at &&
            ` at ${new Date(challenge.claimed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </span>
        {confirming ? (
          <>
            <button
              disabled={pending}
              onClick={undo}
              className="rounded bg-red-600 px-2 py-1 text-white disabled:opacity-50"
            >
              Yes, undo
            </button>
            <button onClick={() => setConfirming(false)} className="rounded border px-2 py-1">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="rounded border bg-white px-2 py-1">
            Undo claim
          </button>
        )}
      </div>
      <Notice compact result={result} />
    </li>
  );
}
