"use client";

import { useActionState } from "react";
import { useLiveTable } from "@/components/useLiveTable";
import { loadTeams } from "@/lib/queries";
import { teamLogin } from "./actions";

export function TeamLoginForm() {
  const { data: teams, error } = useLiveTable("teams", loadTeams);
  const [result, formAction, pending] = useActionState(teamLogin, null);

  if (error) return <p className="text-red-700">Error loading teams: {error}</p>;
  if (!teams) return <p className="text-gray-500">Loading teams…</p>;
  if (teams.length === 0) return <p className="text-gray-500">No teams have been created yet.</p>;

  return (
    <form action={formAction} className="space-y-4">
      <label className="block space-y-1">
        <span className="font-medium">Your team</span>
        <select name="teamId" required defaultValue="" className="w-full rounded-lg border bg-white p-3">
          <option value="" disabled>
            Choose a team…
          </option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Team code</span>
        <input
          name="code"
          required
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full rounded-lg border bg-white p-3"
        />
      </label>
      {result && !result.ok && <p className="rounded-lg bg-red-100 p-3 text-red-800">{result.message}</p>}
      <button
        disabled={pending}
        className="w-full rounded-xl bg-blue-600 p-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
