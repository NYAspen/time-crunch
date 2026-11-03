"use client";

import { useTransition } from "react";
import { showResult } from "@/components/Toasts";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { useServerNow } from "@/components/useServerNow";
import { loadCards, loadCardTypes, loadSteals, loadTeams } from "@/lib/queries";
import { vetoSteal } from "./gameActions";
import { SignBox } from "@/components/SignBox";

// Whether the team holds a Veto card (the database picks which copy to use).
export function useHasVeto(teamId: string) {
  const { data: cards } = useLiveTable("cards", loadCards);
  const { data: types } = useLiveTable("card_types", loadCardTypes);
  if (!cards || !types) return false;
  return cards.some(
    (c) =>
      c.holder_team === teamId &&
      c.status === "hand" &&
      types.find((t) => t.id === c.type_id)?.effect === "veto",
  );
}

// For 60 seconds after another team steals a card from this team, offers a
// Veto to take it back, if the team holds one. (The steal itself pops down at
// the top: app/team/EventFeed.tsx.)
export function StealAlert({ teamId }: { teamId: string }) {
  const { data: steals } = useLiveTable("steals", loadSteals);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const hasVeto = useHasVeto(teamId);
  const serverNow = useServerNow(1000);
  const [pending, startTransition] = useTransition();

  const open =
    steals && serverNow !== null
      ? steals.filter(
          (s) => s.target_team === teamId && !s.vetoed_at && new Date(s.veto_until).getTime() > serverNow,
        )
      : [];
  if (open.length === 0 || !hasVeto) return null;

  const name = (id: string) => teams?.find((t) => t.id === id)?.name ?? "Another team";
  const veto = (id: string) =>
    startTransition(async () => {
      showResult(await vetoSteal(id), { undoable: true });
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-2">
      {open.map((s) => {
        const secondsLeft = Math.max(Math.ceil((new Date(s.veto_until).getTime() - (serverNow ?? 0)) / 1000), 0);
        return (
          <SignBox key={s.id} tone="red" title="! Card stolen">
            <p>
              <b>{name(s.attacker_team)}</b> stole <b>{s.card_name}</b> from your hand.
            </p>
            <button
              disabled={pending}
              onClick={() => veto(s.id)}
              className="w-full rounded-lg bg-red-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              Use Veto to take it back ({secondsLeft} s)
            </button>
          </SignBox>
        );
      })}
    </section>
  );
}
