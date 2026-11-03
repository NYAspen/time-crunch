"use client";

import { useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { drawLabel } from "@/components/ChallengeRewards";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadGameState, loadTeams } from "@/lib/queries";
import { parseEffect, type ActionResult, type Card, type CardType, type PublicTeam } from "@/lib/types";
import { chooseCard, discardCard, openDraw, playCard } from "./gameActions";
import { Notice } from "@/components/Notice";

export function CardHand({ teamId }: { teamId: string }) {
  const { data: cards, error } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: types } = useLiveTable("card_types", loadCardTypes);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  if (error) return <p className="text-red-700">Error loading your cards: {error}</p>;
  if (!cards || !draws || !types || !teams || !game) return <p className="text-gray-500">Loading your cards…</p>;

  const typeOf = (card: Card) => types.find((t) => t.id === card.type_id);
  const mine = cards.filter((c) => c.holder_team === teamId);
  const hand = mine.filter((c) => c.status === "hand");
  const openDrawRow = draws.find((d) => d.team_id === teamId && d.status === "open");
  const offered = openDrawRow ? mine.filter((c) => c.status === "offered" && c.draw_id === openDrawRow.id) : [];
  const waiting = draws.filter((d) => d.team_id === teamId && d.status === "pending");
  const otherTeams = teams.filter((t) => t.id !== teamId && t.status === "active");
  // Curses and steals can only be played during Elimination (checked in the database too).
  const attacksAllowed = game.phase === "elimination";
  const isAttack = (t: CardType) => t.type === "curse" || t.effect === "steal";
  const holdsAttack = hand.some((c) => {
    const t = typeOf(c);
    return !!t && isAttack(t);
  });
  // The game's limit plus this team's "hand +N" bonus. Over it, the team must
  // discard before it can draw or use cards (also checked in the database).
  const limit = game.hand_limit + (teams.find((t) => t.id === teamId)?.hand_bonus ?? 0);
  const excess = Math.max(hand.length - limit, 0);
  const picksLeft = openDrawRow ? openDrawRow.keep - openDrawRow.kept : 0;

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
      <Notice result={result} />

      <HandMeter count={hand.length} limit={limit} />

      {openDrawRow ? (
        <div className="space-y-2 rounded-xl border-2 border-purple-400 bg-purple-50 p-3">
          <div className="font-semibold">
            {picksLeft === 1 ? "Keep one card" : `Keep ${picksLeft} cards`} ({openDrawRow.source})
          </div>
          <p className="text-sm text-gray-600">
            {openDrawRow.kept > 0 ? `${openDrawRow.kept} kept so far. ` : ""}The others go back into the deck.
          </p>
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
              disabled={pending || excess > 0}
              onClick={() => run(openDraw)}
              className="w-full rounded-lg bg-purple-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              {drawLabel(waiting[0].size, waiting[0].keep).replace(/^d/, "D")} ({waiting[0].source})
            </button>
          </div>
        )
      )}

      {excess > 0 && (
        <div className="rounded-xl border-2 border-red-500 bg-red-50 p-3">
          <div className="font-bold text-red-800">Your hand is over the limit</div>
          <p className="text-sm">
            You hold {hand.length} cards and the limit is {limit}. Discard {excess} card
            {excess === 1 ? "" : "s"} before you can draw or use cards.
          </p>
        </div>
      )}

      {game.is_paused ? (
        <p className="text-sm text-gray-600">The game is paused. Cards can be used again when it resumes.</p>
      ) : (
        !attacksAllowed &&
        holdsAttack && (
          <p className="text-sm text-gray-600">Curses and steal cards can be played once Elimination starts.</p>
        )
      )}

      {hand.length === 0 ? (
        <p className="text-gray-500">No cards in your hand yet. Complete challenges to draw cards.</p>
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
                  canUse={!game.is_paused && excess === 0 && (attacksAllowed || !isAttack(t))}
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

// Big "3 / 5" count with one slot per allowed card: grey with room left,
// orange when full, red when over the limit.
function HandMeter({ count, limit }: { count: number; limit: number }) {
  const over = count > limit;
  const full = count === limit;
  const tone = over
    ? "border-red-500 bg-red-50 text-red-800"
    : full
      ? "border-orange-400 bg-orange-50 text-orange-900"
      : "border-gray-300 bg-white text-gray-900";
  const filled = over ? "bg-red-500" : full ? "bg-orange-500" : "bg-gray-900";
  const note = over ? "Over the limit" : full ? "Hand full: keeping another card puts you over" : "Room for more";

  return (
    <div className={`rounded-xl border-2 px-3 py-2 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide">Cards in hand</span>
        <span className="text-2xl font-bold tabular-nums">
          {count} / {limit}
        </span>
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {Array.from({ length: Math.max(count, limit) }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-full ${i < count ? filled : "bg-gray-200"} ${
              i >= limit ? "ring-2 ring-red-300" : ""
            }`}
          />
        ))}
      </div>
      <div className="mt-1 text-xs">{note}</div>
    </div>
  );
}

function HandCard({
  card,
  cardType,
  hand,
  otherTeams,
  canUse,
  typeOf,
  pending,
  run,
}: {
  card: Card;
  cardType: CardType;
  hand: Card[];
  otherTeams: PublicTeam[];
  canUse: boolean; // not while paused or over the hand limit; curses and steals only in Elimination (all checked in the database too)
  typeOf: (card: Card) => CardType | undefined;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const [mode, setMode] = useState<"idle" | "use" | "discard">("idle");
  const [target, setTarget] = useState(""); // duplicate: card to copy
  const [targetTeam, setTargetTeam] = useState(""); // curse / steal: the other team
  const [inRange, setInRange] = useState(false);
  const others = hand.filter((c) => c.id !== card.id);
  const isCurse = cardType.type === "curse";
  const effect = isCurse ? null : parseEffect(cardType.effect);
  const isDuplicateEffect = effect?.kind === "duplicate";
  const isSteal = effect?.kind === "steal";
  const isVeto = effect?.kind === "veto";
  const needsTeam = isCurse || isSteal;
  const ready = canUse && (needsTeam ? !!targetTeam && inRange : isDuplicateEffect ? !!target : true);

  return (
    <CardView cardType={cardType} isDuplicate={card.is_duplicate}>
      {mode === "idle" && (
        <div className="flex gap-2 pt-1">
          {isVeto ? (
            // Veto is never played from here: a Veto button appears when the team
            // is cursed or has a card stolen.
            <p className="flex-1 text-xs text-gray-600">
              Keep this. A Veto button appears when you are cursed or a card is stolen from you.
            </p>
          ) : (
            <button
              disabled={!canUse}
              onClick={() => setMode("use")}
              className="flex-1 rounded-lg bg-gray-900 p-2 font-semibold text-white disabled:opacity-40"
            >
              Use
            </button>
          )}
          <button onClick={() => setMode("discard")} className="rounded-lg border bg-white px-3 text-sm">
            Discard
          </button>
        </div>
      )}

      {mode === "use" && (
        <div className="space-y-2 rounded-lg bg-white p-2">
          {needsTeam ? (
            otherTeams.length === 0 ? (
              <p className="text-sm">There are no other active teams.</p>
            ) : (
              <>
                <select
                  value={targetTeam}
                  onChange={(e) => setTargetTeam(e.target.value)}
                  className="w-full rounded border p-2"
                >
                  <option value="">{isCurse ? "Choose a team to curse…" : "Choose a team to steal from…"}</option>
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
              Use <b>{cardType.name}</b> now? It leaves your hand
              {effect?.kind === "draw"
                ? `, and you get a new draw: ${effect.size} cards, keep ${effect.keep}.`
                : effect?.kind === "hand"
                  ? `, and your hand limit goes up by ${effect.bonus} for the rest of the game.`
                  : ", and your team carries out its effect."}
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
                    targetTeamId: needsTeam ? targetTeam : undefined,
                    inRange: needsTeam ? inRange : undefined,
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
