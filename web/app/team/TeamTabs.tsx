"use client";

import { useState } from "react";
import { TeamList } from "@/components/TeamList";
import { TimeHistory } from "@/components/TimeHistory";
import { useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadGameState, loadLedger } from "@/lib/queries";
import { CardHand } from "./CardHand";
import { ChallengeBoard } from "./ChallengeBoard";

const TABS = [
  { id: "challenges", label: "Challenges" },
  { id: "cards", label: "Cards" },
  { id: "teams", label: "Teams" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Tabs for the lower part of the team page. All panels stay mounted (just
// hidden), so switching is instant and live updates keep arriving.
export function TeamTabs({ teamId }: { teamId: string }) {
  const [tab, setTab] = useState<TabId>("challenges");
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: ledger } = useLiveTable("time_ledger", loadLedger);
  const { data: cards } = useLiveTable("cards", loadCards);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const waitingDraws = draws?.filter((d) => d.team_id === teamId && d.status !== "done").length ?? 0;
  const handSize = cards?.filter((c) => c.holder_team === teamId && c.status === "hand").length ?? 0;
  const overLimit = !!game && handSize > game.hand_limit;

  return (
    <div className="space-y-3">
      <nav
        className="sticky z-10 -mx-4 flex gap-1 border-b bg-gray-50/95 px-4 py-2 backdrop-blur"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 font-semibold ${
              tab === t.id ? "bg-gray-900 text-white" : "bg-white text-gray-700 border"
            }`}
          >
            {t.label}
            {t.id === "cards" && game && (
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  overLimit ? "bg-red-600 text-white" : tab === t.id ? "bg-white/20" : "bg-gray-200 text-gray-700"
                }`}
              >
                {handSize}/{game.hand_limit}
              </span>
            )}
            {t.id === "cards" && waitingDraws > 0 && (
              <span className="rounded-full bg-purple-600 px-1.5 text-xs text-white">{waitingDraws}</span>
            )}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "challenges"}>
        <ChallengeBoard teamId={teamId} />
      </div>
      <div hidden={tab !== "cards"}>
        <CardHand teamId={teamId} />
      </div>
      <div hidden={tab !== "teams"}>
        <TeamList highlightTeamId={teamId} />
        {/* Kept out of the way: only needed to check why your time changed. */}
        <details className="mt-6 text-sm text-gray-500">
          <summary className="cursor-pointer underline">Show my time history</summary>
          <div className="mt-2 text-gray-900">{ledger && <TimeHistory entries={ledger} />}</div>
        </details>
      </div>
    </div>
  );
}
