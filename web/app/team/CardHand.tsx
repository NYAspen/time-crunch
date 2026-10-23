"use client";

import { useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes } from "@/lib/queries";
import type { ActionResult, Card, CardType } from "@/lib/types";
import { chooseCard, discardCard, openDraw, playCard } from "./actions";

export function CardHand({ teamId }: { teamId: string }) {
  const { data: cards, error } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: types } = useLiveTable("card_types", loadCardTypes);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  if (error) return <p className="text-red-700">Error loading your cards: {error}</p>;
  if (!cards || !draws || !types) return <p className="text-gray-500">Loading your cards…</p>;

  const typeOf = (card: Card) => types.find((t) => t.id === card.type_id);
  const mine = cards.filter((c) => c.holder_team === teamId);
  const hand = mine.filter((c) => c.status === "hand");
  const openDrawRow = draws.find((d) => d.team_id === teamId && d.status === "open");
  const offered = openDrawRow ? mine.filter((c) => c.status === "offered" && c.draw_id === openDrawRow.id) : [];
  const waiting = draws.filter((d) => d.team_id === teamId && d.status === "pending");

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Your cards</h2>
      {result && (
        <p className={`rounded-lg p-3 ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {result.message}
        </p>
      )}

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
                <HandCard card={card} cardType={t} hand={hand} typeOf={typeOf} pending={pending} run={run} />
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
  typeOf,
  pending,
  run,
}: {
  card: Card;
  cardType: CardType;
  hand: Card[];
  typeOf: (card: Card) => CardType | undefined;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const [mode, setMode] = useState<"idle" | "use" | "discard">("idle");
  const [target, setTarget] = useState("");
  const others = hand.filter((c) => c.id !== card.id);
  const isDuplicateEffect = cardType.effect === "duplicate";

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
          {isDuplicateEffect ? (
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
              {cardType.type === "curse" && " Tell the target team, and set your countdown speeds as the card says."}
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={pending || (isDuplicateEffect && !target)}
              onClick={() => {
                setMode("idle");
                run(() => playCard(card.id, isDuplicateEffect ? target : undefined));
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
