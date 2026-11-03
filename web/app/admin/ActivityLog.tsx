"use client";

import { useState, useTransition } from "react";
import { drawLabel } from "@/components/ChallengeRewards";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Notice } from "@/components/Notice";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadActivityLog, loadTeams } from "@/lib/queries";
import { formatDelta } from "@/lib/time";
import type { ActionResult, ActivityLogEntry } from "@/lib/types";
import { undoActivity } from "./adminActions";

const PAGE_SIZE = 15;

// Entries the database can undo (admin_undo_activity, migration 0014).
const UNDOABLE = new Set([
  "challenge_claimed",
  "card_used",
  "curse_started",
  "card_discarded",
  "curse_cleared",
  "card_stolen",
  "curse_vetoed",
  "steal_vetoed",
  "time_adjusted",
  "speed_changed",
  "speed_set_by_admin",
  "team_eliminated",
]);

function describe(entry: ActivityLogEntry, teamNames: Record<string, string>) {
  const d = entry.details as Record<string, string | number | undefined>;
  const team = (entry.team_id && teamNames[entry.team_id]) || d.name || "?";
  const byAdmin = d.by === "admin" ? " (admin)" : "";
  switch (entry.event_type) {
    case "phase_changed":
      return `Phase changed to ${d.to}`;
    case "game_paused":
      return "Game paused";
    case "game_resumed":
      return "Game resumed";
    case "challenge_claimed":
      return `${team} completed "${d.challenge}" (${Number(d.multiplier ?? 1) > 1 ? `×${d.multiplier}: ` : ""}${formatDelta(Number(d.minutes) * 60000)}, ${Number(d.multiplier ?? 1) > 1 ? `${d.multiplier} × ` : ""}${drawLabel(Number(d.cards), Number(d.keep ?? 1))})`;
    case "claim_undone":
      return `Claim of "${d.challenge}" by ${team} undone${byAdmin}`;
    case "cards_drawn":
      return `${team} drew ${d.count} card(s) from "${d.source}"`;
    case "card_kept":
      return `${team} kept ${d.card}`;
    case "card_used":
      return (
        `${team} used ${d.card}${d.curse ? ` on the curse ${d.curse}` : ""}${d.target_team ? ` on ${d.target_team}` : ""}` +
        `${d.target_card ? ` (copied ${d.target_card})` : ""}${d.challenge ? ` on "${d.challenge}"` : ""}` +
        `${d.new_challenge ? ` (replaced by "${d.new_challenge}")` : ""}${d.discarded ? ` (discarded ${d.discarded})` : ""}`
      );
    case "card_stolen":
      return `${team} stole ${d.stolen_card} from ${d.target_team} (${d.card})`;
    case "curse_vetoed":
      return `${team} vetoed the curse ${d.card} from ${d.attacker}`;
    case "steal_vetoed":
      return `${team} vetoed ${d.attacker}'s steal and took back ${d.card}`;
    case "curse_started":
      return d.curse
        ? `${team} cursed ${d.target_team} with ${d.curse} too (${d.card})`
        : `${team} cursed ${d.target_team} with ${d.card}`;
    case "card_discarded":
      return `${team} discarded ${d.card}`;
    case "curse_cleared":
      return `${team} cleared the curse ${d.card}${byAdmin}`;
    case "curse_ended":
      return `Curse ${d.card} (${d.attacker} → ${d.target}) ended: ${team} eliminated`;
    case "curse_restarted":
      return `Curse ${d.card} on ${team} restarted${byAdmin}`;
    case "action_undone":
      return `${team} undid: ${d.action}${byAdmin}`;
    case "time_adjusted":
      return `${team}: ${formatDelta(Number(d.seconds) * 1000)} (admin${d.reason ? `: ${d.reason}` : ""})`;
    case "time_entry_undone":
      return `Time entry #${d.entry} undone (admin)`;
    case "speed_changed":
      return `${team} changed speed ${d.from}× → ${d.to}×`;
    case "speed_set_by_admin":
      return `${team} speed set ${d.from}× → ${d.to}× (admin)`;
    case "team_eliminated":
      return `${team} eliminated${byAdmin}`;
    case "team_revived":
      return `${team} back in the game${byAdmin}`;
    case "card_moved_by_admin":
      return `${d.card} moved to ${d.to_team ? (teamNames[d.to_team] ?? "?") : "the deck"} (admin)`;
    case "draw_granted":
      return `${team} given a draw of ${d.size} (admin)`;
    case "draw_cancelled":
      return `${team}'s draw from "${d.source}" cancelled (admin)`;
    case "hand_limit_changed":
      return `Hand limit set to ${d.limit}`;
    case "board_size_changed":
      return `Board size set to ${d.size}`;
    case "game_reset":
      return "Game reset";
    default: {
      const extra = Object.entries(d)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ");
      const label = entry.event_type.replaceAll("_", " ");
      return extra ? `${label} (${extra})` : label;
    }
  }
}

// Everything that happened, newest first. Mistakes are undone from here.
export function ActivityLog() {
  const { data: entries, error } = useLiveTable("activity_log", loadActivityLog);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [shown, setShown] = useState(PAGE_SIZE);

  const teamNames = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <CollapsibleSection title="Activity log" summary="newest first, with Undo">
      {error && <p className="text-red-700">Error: {error}</p>}
      {entries?.length === 0 && <p className="text-gray-500">Nothing yet.</p>}
      <ul className="divide-y text-sm">
        {entries?.slice(0, shown).map((entry) => (
          <ActivityRow key={entry.id} entry={entry} text={describe(entry, teamNames)} />
        ))}
      </ul>
      {entries && entries.length > shown && (
        <button onClick={() => setShown(shown + PAGE_SIZE)} className="w-full rounded border p-2 text-sm text-gray-600">
          Show more
        </button>
      )}
    </CollapsibleSection>
  );
}

function ActivityRow({ entry, text }: { entry: ActivityLogEntry; text: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();
  const undone = entry.undone_at !== null;

  const undo = () =>
    startTransition(async () => {
      setResult(await undoActivity(entry.id));
      setConfirming(false);
      refreshAllLiveTables();
    });

  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 font-mono text-gray-500">
          {new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
        </span>
        <span className={`min-w-0 flex-1 ${undone ? "text-gray-400 line-through" : ""}`}>{text}</span>
        {undone && <span className="text-xs text-gray-500">undone</span>}
        {!undone &&
          UNDOABLE.has(entry.event_type) &&
          (confirming ? (
            <>
              <button
                disabled={pending}
                onClick={undo}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Yes, undo
              </button>
              <button onClick={() => setConfirming(false)} className="rounded border px-3 py-1 text-sm">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} className="rounded border bg-white px-3 py-1 text-sm">
              Undo
            </button>
          ))}
      </div>
      <Notice compact result={result} />
    </li>
  );
}
