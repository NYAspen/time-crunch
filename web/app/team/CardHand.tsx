"use client";

import { useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { drawLabel } from "@/components/ChallengeRewards";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadGameState, loadTeams } from "@/lib/queries";
import { parseEffect, type ActionResult, type Card, type CardType, type PublicTeam } from "@/lib/types";
import { chooseCard, discardCard, openDraw, playCard } from "./gameActions";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

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
  // Curses can only be played during Elimination (checked in the database too).
  // Steals work in either phase.
  const attacksAllowed = game.phase === "elimination";
  const isAttack = (t: CardType) => t.type === "curse";
  const holdsAttack = hand.some((c) => {
    const t = typeOf(c);
    return !!t && isAttack(t);
  });
  // The game's limit plus this team's "hand +N" bonus. Over it, the team must
  // discard before it can draw or use cards (also checked in the database).
  const limit = game.hand_limit + (teams.find((t) => t.id === teamId)?.hand_bonus ?? 0);
  const excess = Math.max(hand.length - limit, 0);
  const picksLeft = openDrawRow ? openDrawRow.keep - openDrawRow.kept : 0;
  // An eliminated team keeps its cards but can't draw, use or discard them
  // (checked in the database too); the admin can still move them.
  const eliminated = teams.find((t) => t.id === teamId)?.status !== "active";

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
      <Notice result={result} />

      <HandMeter count={hand.length} limit={limit} />

      {eliminated ? (
        <SignBox tone="black" title="Your team has been eliminated" />
      ) : openDrawRow ? (
        <SignBox
          tone="purple"
          bodyClassName="bg-gray-100"
          title={`${picksLeft === 1 ? "Keep one card" : `Keep ${picksLeft} cards`} (${openDrawRow.source})`}
        >
          <p className="text-sm text-gray-600">
            {openDrawRow.kept > 0 ? `${openDrawRow.kept} kept so far. ` : ""}The others go back into the deck.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {offered.map((card) => {
              const t = typeOf(card);
              return t ? (
                <CardView key={card.id} cardType={t} compact>
                  <button
                    disabled={pending}
                    onClick={() => run(() => chooseCard(card.id))}
                    className="mt-1 w-full rounded-lg bg-purple-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Keep
                  </button>
                </CardView>
              ) : null;
            })}
          </div>
        </SignBox>
      ) : (
        waiting.length > 0 && (
          <SignBox
            tone="purple"
            title={`You have ${waiting.length} card draw${waiting.length === 1 ? "" : "s"} waiting`}
          >
            <button
              disabled={pending || excess > 0}
              onClick={() => run(openDraw)}
              className="w-full rounded-lg bg-purple-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              {drawLabel(waiting[0].size, waiting[0].keep).replace(/^d/, "D")} ({waiting[0].source})
            </button>
          </SignBox>
        )
      )}

      {excess > 0 && !eliminated && (
        <SignBox tone="red" title="! Your hand is over the limit">
          <p className="text-sm">
            You hold {hand.length} cards and the limit is {limit}. Tap <b>Discard</b> on {excess} card
            {excess === 1 ? "" : "s"} below before you can draw or use cards.
          </p>
        </SignBox>
      )}

      {eliminated ? null : game.is_paused ? (
        <p className="text-sm text-gray-600">The game is paused. Cards can be used again when it resumes.</p>
      ) : (
        !attacksAllowed &&
        holdsAttack && (
          <p className="text-sm text-gray-600">Curses can be played once Elimination starts.</p>
        )
      )}

      {hand.length === 0 ? (
        <p className="text-gray-500">No cards in your hand yet. Complete challenges to draw cards.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {hand.map((card) => {
            const t = typeOf(card);
            return t ? (
              <HandCard
                key={card.id}
                card={card}
                cardType={t}
                hand={hand}
                otherTeams={otherTeams}
                canUse={!eliminated && !game.is_paused && excess === 0 && (attacksAllowed || !isAttack(t))}
                canDiscard={!eliminated && excess > 0}
                typeOf={typeOf}
                pending={pending}
                run={run}
              />
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
            className={`h-3 flex-1 ${i < count ? filled : "bg-gray-200"} ${
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
  canDiscard,
  typeOf,
  pending,
  run,
}: {
  card: Card;
  cardType: CardType;
  hand: Card[];
  otherTeams: PublicTeam[];
  canUse: boolean; // not while paused or over the hand limit; curses only in Elimination (all checked in the database too)
  canDiscard: boolean; // Discard only shows while the hand is over the limit
  typeOf: (card: Card) => CardType | undefined;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const [mode, setMode] = useState<"idle" | "use" | "discard">("idle");
  const [target, setTarget] = useState(""); // duplicate: card to copy
  const [targetTeam, setTargetTeam] = useState(""); // curse / steal: the other team
  const [inRange, setInRange] = useState(false);
  const [stealFailed, setStealFailed] = useState<ActionResult>(null); // shown on this card
  const others = hand.filter((c) => c.id !== card.id);
  const isCurse = cardType.type === "curse";
  const effect = isCurse ? null : parseEffect(cardType.effect);
  const isDuplicateEffect = effect?.kind === "duplicate";
  const isSteal = effect?.kind === "steal";
  const isVeto = effect?.kind === "veto";
  const needsTeam = isCurse || isSteal;
  const ready = canUse && (needsTeam ? !!targetTeam && inRange : isDuplicateEffect ? !!target : true);

  // Compact, two to a row, and it stays that size while being used or
  // discarded: the confirm controls are stacked to fit the narrow card.
  return (
    <li>
      <CardView cardType={cardType} isDuplicate={card.is_duplicate} compact>
        {mode === "idle" && (
          <div className="flex flex-col items-start gap-2 pt-1">
            {stealFailed && (
              <div className="w-full">
                <Notice compact result={stealFailed} />
              </div>
            )}
            {isVeto ? (
              // Veto is never played from here: a Veto button appears when the team
              // is cursed or has a card stolen.
              <p className="text-xs text-gray-600">
                A Veto button appears when you are cursed or a card is stolen from you.
              </p>
            ) : (
              <button
                disabled={!canUse}
                onClick={() => setMode("use")}
                className="w-full rounded-lg bg-gray-900 p-2 font-semibold text-white disabled:opacity-40"
              >
                Use
              </button>
            )}
            {canDiscard && (
              <button
                onClick={() => setMode("discard")}
                className="w-full rounded-lg bg-red-600 p-2 text-sm font-bold tracking-wide text-white uppercase"
              >
                Discard
              </button>
            )}
          </div>
        )}

        {mode === "use" && (
          <div className="space-y-2 border border-gray-300 bg-gray-50 p-1.5">
            {needsTeam ? (
              otherTeams.length === 0 ? (
                <p>There are no other active teams.</p>
              ) : (
                <>
                  <select
                    value={targetTeam}
                    onChange={(e) => setTargetTeam(e.target.value)}
                    className="w-full rounded border bg-white px-1 py-2"
                  >
                    <option value="">Pick a team</option>
                    {otherTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-start gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={inRange}
                      onChange={(e) => setInRange(e.target.checked)}
                      className="mt-0.5"
                    />
                    {/* The range isn't always "near the target" (e.g. near a place, or the
                        team furthest from you), so confirm the card's own wording. */}
                    <span>
                      {cardType.range_text ? (
                        <>
                          Range condition met: <b>{cardType.range_text}</b>
                        </>
                      ) : (
                        "This card's range condition is met."
                      )}
                    </span>
                  </label>
                </>
              )
            ) : isDuplicateEffect ? (
              others.length === 0 ? (
                <p>You need another card in your hand to duplicate.</p>
              ) : (
                <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded border bg-white px-1 py-2">
                  <option value="">Pick a card</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {typeOf(c)?.name}
                    </option>
                  ))}
                </select>
              )
            ) : (
              <p>
                Use <b>{cardType.name}</b> now? It leaves your hand
                {effect?.kind === "draw"
                  ? `, and you get a new draw: ${effect.size} cards, keep ${effect.keep}.`
                  : effect?.kind === "hand"
                    ? `, and your hand limit goes up by ${effect.bonus} for the rest of the game.`
                    : ", and your team carries out its effect."}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <button
                disabled={pending || !ready}
                onClick={() => {
                  setMode("idle");
                  setStealFailed(null);
                  run(async () => {
                    const r = await playCard(card.id, {
                      targetCardId: isDuplicateEffect ? target : undefined,
                      targetTeamId: needsTeam ? targetTeam : undefined,
                      inRange: needsTeam ? inRange : undefined,
                    });
                    // An empty target hand: a small note on the card instead of the big error.
                    const empty = r && !r.ok && r.message.match(/^(.*) has no cards to steal$/);
                    if (isSteal && empty) {
                      setStealFailed({
                        ok: false,
                        message: `Steal failed: ${empty[1]} has no cards. Your card is still in your hand.`,
                      });
                      return null;
                    }
                    return r;
                  });
                }}
                className="rounded-lg bg-gray-900 p-2 font-semibold text-white disabled:opacity-40"
              >
                Yes, use it
              </button>
              <button onClick={() => setMode("idle")} className="rounded-lg border bg-white p-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "discard" && (
          <div className="space-y-2 border border-gray-300 bg-gray-50 p-1.5">
            <p>Discard {cardType.name}? It goes back into the deck.</p>
            <div className="flex flex-col gap-1.5">
              <button
                disabled={pending}
                onClick={() => {
                  setMode("idle");
                  run(() => discardCard(card.id));
                }}
                className="rounded-lg bg-red-600 p-2 font-semibold text-white disabled:opacity-50"
              >
                Yes, discard
              </button>
              <button onClick={() => setMode("idle")} className="rounded-lg border bg-white p-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardView>
    </li>
  );
}
