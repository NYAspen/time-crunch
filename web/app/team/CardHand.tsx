"use client";

import { useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadTeams } from "@/lib/queries";
import type { ActionResult, Card, CardType, PublicTeam } from "@/lib/types";
import { chooseCard, discardCard, openDraw, playCard } from "./gameActions";
import { Notice } from "@/components/Notice";

export function CardHand({ teamId }: { teamId: string }) {
  const { data: cards, error } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: types } = useLiveTable("card_types", loadCardTypes);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  if (error) return <p className="text-red-700">Error loading your cards: {error}</p>;
  if (!cards || !draws || !types || !teams) return <p className="text-gray-500">Loading your cards…</p>;

  const typeOf = (card: Card) => types.find((t) => t.id === card.type_id);
  const mine = cards.filter((c) => c.holder_team === teamId);
  const hand = mine.filter((c) => c.status === "hand");
  const openDrawRow = draws.find((d) => d.team_id === teamId && d.status === "open");
  const offered = openDrawRow ? mine.filter((c) => c.status === "offered" && c.draw_id === openDrawRow.id) : [];
  const waiting = draws.filter((d) => d.team_id === teamId && d.status === "pending");
  const otherTeams = teams.filter((t) => t.id !== teamId && t.status === "active");

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
      <Notice result={result} />

      {openDrawRow ? (
        <div className="space-y-2 rounded-xl border-2 border-purple-400 bg-purple-50 p-3">
          <div className="font-semibold">Keep one card ({openDrawRow.source})</div>
          <p className="text-sm text-gray-600">The others go back into the deck.</p>
          {offered.map((card) => {
            const t = typeOf(card);
            return t ? (
              <CardView key={card.id} cardType={t}>
                <button
                  disabled={pending}
                  onClick={() => run(() => chooseCard(card.id))}
                  className="mt-1 w-full rounded-lg bg-purple-600 p-2 font-semibold text-white disabled:opacity-50"
                >
                  Keep this card
                </button>
              </CardView>
            ) : null;
          })}
        </div>
      ) : (
        waiting.length > 0 && (
          <div className="space-y-2 rounded-xl border-2 border-purple-400 bg-purple-50 p-3">
            <div className="font-semibold">
              You have {waiting.length} card draw{waiting.length === 1 ? "" : "s"} waiting
            </div>
            <button
              disabled={pending}
              onClick={() => run(openDraw)}
              className="w-full rounded-lg bg-purple-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              Draw {waiting[0].size} card{waiting[0].size === 1 ? "" : "s"} ({waiting[0].source})
            </button>
          </div>
        )
      )}

      {hand.length === 0 ? (
        <p className="text-gray-500">No cards in your hand yet. Claim challenges to draw cards.</p>
      ) : (
        <ul className="space-y-2">
          {hand.map((card) => {
            const t = typeOf(card);
            return t ? (
              <li key={card.id}>
                <HandCard
                  card={card}
                  cardType={t}
                  hand={hand}
                  otherTeams={otherTeams}
                  typeOf={typeOf}
                  pending={pending}
                  run={run}
                />
              </li>
            ) : null;
          })}
        </ul>
      )}
    </section>
  );
}

function HandCard({
  card,
  cardType,
  hand,
  otherTeams,
  typeOf,
  pending,
  run,
}: {
  card: Card;
  cardType: CardType;
  hand: Card[];
  otherTeams: PublicTeam[];
  typeOf: (card: Card) => CardType | undefined;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const [mode, setMode] = useState<"idle" | "use" | "discard">("idle");
  const [target, setTarget] = useState(""); // duplicate: card to copy
  const [targetTeam, setTargetTeam] = useState(""); // curse: team to curse
  const [inRange, setInRange] = useState(false);
  const others = hand.filter((c) => c.id !== card.id);
  const isCurse = cardType.type === "curse";
  const isDuplicateEffect = !isCurse && cardType.effect === "duplicate";
  const ready = isCurse ? !!targetTeam && inRange : isDuplicateEffect ? !!target : true;

  return (
    <CardView cardType={cardType} isDuplicate={card.is_duplicate}>
      {mode === "idle" && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => setMode("use")} className="flex-1 rounded-lg bg-gray-900 p-2 font-semibold text-white">
            Use
          </button>
          <button onClick={() => setMode("discard")} className="rounded-lg border bg-white px-3 text-sm">
            Discard
          </button>
        </div>
      )}

      {mode === "use" && (
        <div className="space-y-2 rounded-lg bg-white p-2">
          {isCurse ? (
            otherTeams.length === 0 ? (
              <p className="text-sm">There are no other active teams to curse.</p>
            ) : (
              <>
                <select
                  value={targetTeam}
                  onChange={(e) => setTargetTeam(e.target.value)}
                  className="w-full rounded border p-2"
                >
                  <option value="">Choose a team to curse…</option>
                  {otherTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inRange}
                    onChange={(e) => setInRange(e.target.checked)}
                    className="mt-1"
                  />
                  <span>We are within range of this team{cardType.range_text ? ` (${cardType.range_text})` : ""}.</span>
                </label>
              </>
            )
          ) : isDuplicateEffect ? (
            others.length === 0 ? (
              <p className="text-sm">You need another card in your hand to duplicate.</p>
            ) : (
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded border p-2">
                <option value="">Choose a card to copy…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {typeOf(c)?.name}
                  </option>
                ))}
              </select>
            )
          ) : (
            <p className="text-sm">
              Use <b>{cardType.name}</b> now? It leaves your hand, and your team carries out its effect.
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={pending || !ready}
              onClick={() => {
                setMode("idle");
                run(() =>
                  playCard(card.id, {
                    targetCardId: isDuplicateEffect ? target : undefined,
                    targetTeamId: isCurse ? targetTeam : undefined,
                    inRange: isCurse ? inRange : undefined,
                  }),
                );
              }}
              className="flex-1 rounded-lg bg-gray-900 p-2 font-semibold text-white disabled:opacity-40"
            >
              Yes, use it
            </button>
            <button onClick={() => setMode("idle")} className="flex-1 rounded-lg border p-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "discard" && (
        <div className="space-y-2 rounded-lg bg-white p-2">
          <p className="text-sm">Discard {cardType.name}? It goes back into the deck.</p>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() => {
                setMode("idle");
                run(() => discardCard(card.id));
              }}
              className="flex-1 rounded-lg bg-red-600 p-2 font-semibold text-white disabled:opacity-50"
            >
              Yes, discard
            </button>
            <button onClick={() => setMode("idle")} className="flex-1 rounded-lg border p-2">
              Cancel
            </button>
          </div>
        </div>
      )}
    </CardView>
  );
}
