"use client";

import { useActionState, useState, useTransition } from "react";
import { ChallengeRewards } from "@/components/ChallengeRewards";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { refreshAllLiveTables, useLiveTable, withRefresh } from "@/components/useLiveTable";
import { loadChallenges, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, Challenge } from "@/lib/types";
import { importChallenges, setBoardSize, setChallengeStatus, updateChallenge } from "./actions";

const EXAMPLE = "title\ttask\treward_cards\treward_minutes\nBean selfie\tTeam photo reflected in Cloud Gate\t2\t15";

function Message({ result }: { result: ActionResult }) {
  if (!result) return null;
  return (
    <p className={`rounded-lg p-2 text-sm ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
      {result.message}
    </p>
  );
}

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
        <p className="rounded-lg bg-yellow-100 p-2 text-sm text-yellow-900">
          The pool has run out, so the board isn&apos;t full. Import more challenges.
        </p>
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
      <Message result={sizeResult} />

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Import challenges</summary>
        <form action={importAction} className="mt-2 space-y-2">
          <p className="text-sm text-gray-600">
            In Google Sheets, select the header row plus the challenge rows, copy, and paste here. Columns:{" "}
            <code>title, task, reward_cards, reward_minutes</code>. New challenges go into the pool, and the board fills
            from it at random.
          </p>
          <textarea
            name="table"
            rows={6}
            placeholder={EXAMPLE}
            className="w-full rounded border p-2 font-mono text-xs"
          />
          <button
            disabled={importing}
            className="w-full rounded bg-blue-600 p-2 font-semibold text-white disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <Message result={importResult} />
        </form>
      </details>

      <ChallengeGroup title="On the board" challenges={active} onChanged={refreshAllLiveTables} />
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
              <li key={c.id} className="py-2">
                <b>{c.title}</b> — {teamName(c.claimed_by)}
                {c.claimed_at &&
                  ` at ${new Date(c.claimed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">
            To reverse a claim&apos;s time bonus, use Undo in the time history.
          </p>
        </details>
      )}
    </CollapsibleSection>
  );
}

function ChallengeGroup({
  title,
  challenges,
  onChanged,
  collapsed,
}: {
  title: string;
  challenges: Challenge[];
  onChanged: () => void;
  collapsed?: boolean;
}) {
  const list = (
    <ul className="mt-2 space-y-2">
      {challenges.length === 0 && <li className="text-sm text-gray-500">None.</li>}
      {challenges.map((c) => (
        <ChallengeRow key={c.id} challenge={c} onChanged={onChanged} />
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

function ChallengeRow({ challenge, onChanged }: { challenge: Challenge; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
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
          <div className="font-medium">{challenge.title}</div>
          {challenge.task && <div className="text-sm text-gray-600">{challenge.task}</div>}
          <ChallengeRewards challenge={challenge} />
        </div>
        <button onClick={() => setEditing(!editing)} className="shrink-0 rounded border px-2 py-1 text-sm">
          {editing ? "Close" : "Edit"}
        </button>
      </div>

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
      <Message result={result} />
    </li>
  );
}
