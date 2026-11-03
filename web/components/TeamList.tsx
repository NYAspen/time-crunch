"use client";

import { loadTeams } from "@/lib/queries";
import { useLiveTable } from "./useLiveTable";

export function TeamList({ highlightTeamId }: { highlightTeamId?: string }) {
  const { data: teams, error } = useLiveTable("teams", loadTeams);

  if (error) return <p className="text-red-700">Error: {error}</p>;
  if (!teams) return <p className="text-gray-500">Loading teams…</p>;
  if (teams.length === 0) return <p className="text-gray-500">No teams yet.</p>;

  return (
    <ul className="divide-y rounded-xl border bg-white">
      {teams.map((team) => (
        <li key={team.id} className="flex items-center justify-between p-3">
          <span className={team.id === highlightTeamId ? "font-bold" : ""}>
            {team.name}
            {team.id === highlightTeamId && " (you)"}
            {team.status === "active" && team.speed !== 1 && (
              <span className="ml-2 rounded-sm border-2 border-orange-600 px-1 text-xs font-bold text-orange-700">{team.speed}×</span>
            )}
          </span>
          <span
            className={
              team.status === "active"
                ? "rounded-sm border-2 border-green-600 px-1.5 text-xs font-bold uppercase tracking-wide text-green-700"
                : "rounded-sm border-2 border-gray-400 px-1.5 text-xs font-bold uppercase tracking-wide text-gray-600"
            }
          >
            {team.status === "active" ? "Active" : "Eliminated"}
          </span>
        </li>
      ))}
    </ul>
  );
}
