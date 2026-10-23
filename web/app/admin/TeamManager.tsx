"use client";

import { useActionState, useState, useTransition } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { refreshAllLiveTables, useLiveTable, withRefresh } from "@/components/useLiveTable";
import { loadTeams } from "@/lib/queries";
import { MIN_CODE_LENGTH, type ActionResult, type PublicTeam } from "@/lib/types";
import { createTeam, deleteTeam, renameTeam, resetTeamCode } from "./actions";
import { Notice } from "@/components/Notice";

export function TeamManager() {
  const { data: teams, error } = useLiveTable("teams", loadTeams);
  const [createResult, createAction, creating] = useActionState(withRefresh(createTeam), null);

  return (
    <CollapsibleSection title="Team logins" summary={teams ? `${teams.length} teams` : undefined}>
      <form action={createAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
        <div className="font-medium">Add a team</div>
        <input
          name="name"
          placeholder="Team name"
          required
          maxLength={40}
          className="w-full rounded-lg border bg-white p-2"
        />
        <input
          name="code"
          placeholder={`Secret code (${MIN_CODE_LENGTH}+ characters)`}
          required
          minLength={MIN_CODE_LENGTH}
          autoCapitalize="none"
          autoComplete="off"
          className="w-full rounded-lg border bg-white p-2"
        />
        <button
          disabled={creating}
          className="w-full rounded-lg bg-blue-600 p-2 font-semibold text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create team"}
        </button>
        <Notice compact result={createResult} />
      </form>

      {error && <p className="text-red-700">Error: {error}</p>}
      {teams?.length === 0 && <p className="text-gray-500">No teams yet.</p>}
      <ul className="space-y-2">
        {teams?.map((team) => (
          <TeamRow key={team.id} team={team} />
        ))}
      </ul>
    </CollapsibleSection>
  );
}

function TeamRow({ team }: { team: PublicTeam }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      refreshAllLiveTables();
    });

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{team.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{team.status}</span>
          <button onClick={() => setEditing(!editing)} className="rounded border px-2 py-1 text-sm">
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="space-y-2">
          <form action={(fd) => run(() => renameTeam(team.id, fd))} className="flex gap-2">
            <input
              name="name"
              defaultValue={team.name}
              required
              maxLength={40}
              className="min-w-0 flex-1 rounded border p-2"
            />
            <button disabled={pending} className="rounded bg-gray-800 px-3 text-sm text-white disabled:opacity-50">
              Rename
            </button>
          </form>
          <form action={(fd) => run(() => resetTeamCode(team.id, fd))} className="flex gap-2">
            <input
              name="code"
              placeholder="New code"
              required
              minLength={MIN_CODE_LENGTH}
              autoCapitalize="none"
              autoComplete="off"
              className="min-w-0 flex-1 rounded border p-2"
            />
            <button disabled={pending} className="rounded bg-gray-800 px-3 text-sm text-white disabled:opacity-50">
              Set code
            </button>
          </form>
          {confirmDelete ? (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => run(() => deleteTeam(team.id))}
                className="flex-1 rounded bg-red-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Yes, delete {team.name}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded border p-2 text-sm">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded border border-red-300 p-2 text-sm text-red-700"
            >
              Delete team
            </button>
          )}
        </div>
      )}
      <Notice compact result={result} />
    </li>
  );
}
