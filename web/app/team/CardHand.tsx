"use client";

import { useState, useTransition } from "react";
import { showResult } from "@/components/Toasts";
import { CardView } from "@/components/CardView";
import { drawLabel } from "@/components/ChallengeRewards";
import { refreshAllLiveTables, useLiveTable } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadChallenges, loadCurses, loadGameState, loadTeams } from "@/lib/queries";
import {
  parseEffect,
  type ActionResult,
  type Card,
  type CardType,
  type Challenge,
  type Curse,
  type ParsedEffect,
  type Phase,
  type PublicTeam,
} from "@/lib/types";
import { chooseCard, discardCard, openDraw, playCard } from "./gameActions";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

export function CardHand({ teamId }: { teamId: string }) {
  const { data: cards, error } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: types } = useLiveTable("card_types", loadCardTypes);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const { data: curses } = useLiveTable("curses", loadCurses);
  const { data: challenges } = useLiveTable("challenges", loadChallenges);
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
  // Only one curse at a time from this team on each other team (checked in the database too).
  const myCurses = (curses ?? []).filter((c) => c.status === "active" && c.attacker_team === teamId);
  const cursing = new Set(myCurses.map((c) => c.target_team));
  const board = (challenges ?? [])
    .filter((c) => c.status === "active")
    .sort((a, b) => (a.activated_at ?? "").localeCompare(b.activated_at ?? ""));
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "another team";
  // Curses (and power-ups that work on curses) only during Elimination;
  // challenge power-ups only during Preparation. Steals work in either phase.
  // All checked in the database too.
  const holds = (phase: Phase) =>
    hand.some((c) => {
      const t = typeOf(c);
      return !!t && phaseNeeded(t) === phase;
    });
  // The game's limit plus this team's "hand +N" bonus. Over it, the team must
  // discard before it can draw or use cards (also checked in the database).
  const limit = game.hand_limit + (teams.find((t) => t.id === teamId)?.hand_bonus ?? 0);
  const excess = Math.max(hand.length - limit, 0);
  const picksLeft = openDrawRow ? openDrawRow.keep - openDrawRow.kept : 0;
  // An eliminated team keeps its cards but can't draw, use or discard them
  // (checked in the database too); the admin can still move them.
  const eliminated = teams.find((t) => t.id === teamId)?.status !== "active";
  const rewardWaiting = teams.find((t) => t.id === teamId)?.reward_multiplier ?? 1;

  // Using and discarding can be undone: their result shows in the Undo bar.
  const run = (action: () => Promise<ActionResult>, undoable = false) =>
    startTransition(async () => {
      showResult(await action(), { undoable });
      refreshAllLiveTables();
    });

  return (
    <section className="space-y-3">
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
      ) : game.phase === "preparation" ? (
        holds("elimination") && (
          <p className="text-sm text-gray-600">Curses can be played once Elimination starts.</p>
        )
      ) : (
        holds("preparation") && (
          <p className="text-sm text-gray-600">Challenge power-ups only work during Preparation.</p>
        )
      )}

      {hand.length === 0 ? (
        <p className="text-gray-500"></p>
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
                cursing={cursing}
                myCurses={myCurses}
                board={board}
                teamId={teamId}
                teamName={teamName}
                canUse={
                  !eliminated &&
                  !game.is_paused &&
                  excess === 0 &&
                  (phaseNeeded(t) ?? game.phase) === game.phase &&
                  // Reward bonuses don't stack: one waiting at a time.
                  !(parseEffect(t.effect)?.kind === "reward" && rewardWaiting > 1)
                }
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

// The phase a card can only be played in, or null for either.
function phaseNeeded(t: CardType): Phase | null {
  if (t.type === "curse") return "elimination";
  const kind = parseEffect(t.effect)?.kind;
  if (kind === "curseBoost" || kind === "curseCopy") return "elimination";
  if (kind === "reward" || kind === "replaceChallenge" || kind === "lockChallenge") return "preparation";
  return null;
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
  const note = over ? "Over the limit" : full ? "Hand full: keeping another card puts you over" : "";

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
  cursing,
  myCurses,
  board,
  teamId,
  teamName,
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
  cursing: Set<string>; // teams this team already has a curse on
  myCurses: Curse[]; // this team's active curses (curse xN / curse copy)
  board: Challenge[]; // challenges on the board (replace / lock challenge)
  teamId: string;
  teamName: (id: string | null) => string;
  canUse: boolean; // not while paused or over the hand limit; curses only in Elimination (all checked in the database too)
  canDiscard: boolean; // Discard only shows while the hand is over the limit
  typeOf: (card: Card) => CardType | undefined;
  pending: boolean;
  run: (action: () => Promise<ActionResult>, undoable?: boolean) => void;
}) {
  const [mode, setMode] = useState<"idle" | "use" | "discard">("idle");
  const [target, setTarget] = useState(""); // duplicate: card to copy
  const [targetTeam, setTargetTeam] = useState(""); // curse / steal: the other team
  const [inRange, setInRange] = useState(false);
  const [curseId, setCurseId] = useState(""); // curse xN / curse copy: one of your curses
  const [challengeId, setChallengeId] = useState(""); // replace / lock challenge
  const [picked, setPicked] = useState<string[]>([]); // discard X draw Y: cards to discard
  const [stealFailed, setStealFailed] = useState<ActionResult>(null); // shown on this card
  const others = hand.filter((c) => c.id !== card.id);
  const isCurse = cardType.type === "curse";
  const effect = isCurse ? null : parseEffect(cardType.effect);
  const isDuplicateEffect = effect?.kind === "duplicate";
  const isSteal = effect?.kind === "steal";
  const isVeto = effect?.kind === "veto";
  const isCurseCopy = effect?.kind === "curseCopy";
  const needsTeam = isCurse || isSteal || isCurseCopy;
  const needsRange = isCurse || isCurseCopy;
  const needsCurse = effect?.kind === "curseBoost" || isCurseCopy;
  const needsChallenge = effect?.kind === "replaceChallenge" || effect?.kind === "lockChallenge";
  const discardCount = effect?.kind === "discardDraw" ? effect.discard : 0;
  // discard X draw Y can't be used without X other cards (checked in the database too).
  const tooFewToDiscard = others.length < discardCount;
  const ready =
    canUse &&
    (!needsTeam || !!targetTeam) &&
    (!needsRange || inRange) &&
    (!needsCurse || !!curseId) &&
    (!needsChallenge || !!challengeId) &&
    picked.length === discardCount &&
    (!isDuplicateEffect || !!target);
  // A curse copy's range is the copied curse's range.
  const rangeText = isCurseCopy
    ? (myCurses.find((c) => c.id === curseId)?.range_text ?? "")
    : cardType.range_text;

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
              // is cursed.
              <p className="text-xs text-gray-600">A Veto button appears when you are cursed.</p>
            ) : (
              <>
                <button
                  disabled={!canUse || tooFewToDiscard}
                  onClick={() => setMode("use")}
                  className="w-full rounded-lg bg-gray-900 p-2 font-semibold text-white disabled:opacity-40"
                >
                  Use
                </button>
                {tooFewToDiscard && (
                  <p className="text-xs text-gray-600">
                    Needs {discardCount} other card{discardCount === 1 ? "" : "s"} in your hand to discard.
                  </p>
                )}
              </>
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
            {needsCurse &&
              (myCurses.length === 0 ? (
                <p>You need an active curse on another team first.</p>
              ) : (
                <select
                  value={curseId}
                  onChange={(e) => setCurseId(e.target.value)}
                  className="w-full rounded border bg-white px-1 py-2"
                >
                  <option value="">Pick one of your curses</option>
                  {myCurses.map((c) => (
                    // Boosts don't stack: a boosted curse can't be boosted again.
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={effect?.kind === "curseBoost" && c.attacker_gain > 1}
                    >
                      {c.card_name} on {teamName(c.target_team)}
                      {c.attacker_gain > 1 ? ` (already boosted: you gain ${c.attacker_gain}×)` : ""}
                    </option>
                  ))}
                </select>
              ))}
            {needsChallenge &&
              (board.length === 0 ? (
                <p>There are no challenges on the board.</p>
              ) : (
                <select
                  value={challengeId}
                  onChange={(e) => setChallengeId(e.target.value)}
                  className="w-full rounded border bg-white px-1 py-2"
                >
                  <option value="">Pick a challenge</option>
                  {board.map((c) => {
                    // Lock: any locked one is taken. Replace: only another team's lock blocks it.
                    const blocked =
                      !!c.locked_by && (effect?.kind === "lockChallenge" || c.locked_by !== teamId);
                    return (
                      <option key={c.id} value={c.id} disabled={blocked}>
                        {c.title}
                        {c.locked_by ? ` (locked by ${c.locked_by === teamId ? "you" : teamName(c.locked_by)})` : ""}
                      </option>
                    );
                  })}
                </select>
              ))}
            {effect?.kind === "discardDraw" &&
              (others.length < discardCount ? (
                <p>
                  You need {discardCount} other card{discardCount === 1 ? "" : "s"} in your hand to discard.
                </p>
              ) : (
                <fieldset className="space-y-1 text-xs">
                  <legend className="mb-1">
                    Discard {discardCount} ({picked.length} picked), then draw {effect.draw}:
                  </legend>
                  {others.map((c) => (
                    <label key={c.id} className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={picked.includes(c.id)}
                        disabled={!picked.includes(c.id) && picked.length >= discardCount}
                        onChange={(e) =>
                          setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((id) => id !== c.id)))
                        }
                        className="mt-0.5"
                      />
                      <span>{typeOf(c)?.name}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
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
                    {otherTeams.map((t) => {
                      const taken = (isCurse || isCurseCopy) && cursing.has(t.id);
                      return (
                        <option key={t.id} value={t.id} disabled={taken}>
                          {t.name}
                          {taken ? " (already cursed by you)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {needsRange && (
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
                        {rangeText ? (
                          <>
                            Range condition met: <b>{rangeText}</b>
                          </>
                        ) : (
                          "This card's range condition is met."
                        )}
                      </span>
                    </label>
                  )}
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
                {effectNote(effect)}
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
                      inRange: needsRange ? inRange : undefined,
                      curseId: needsCurse ? curseId : undefined,
                      challengeId: needsChallenge ? challengeId : undefined,
                      cardIds: discardCount > 0 ? picked : undefined,
                    });
                    setPicked([]);
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
                  }, true);
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
                  run(() => discardCard(card.id), true);
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

// The rest of "Use <card> now? It leaves your hand…".
function effectNote(effect: ParsedEffect | null) {
  switch (effect?.kind) {
    case "draw":
      return `, and you get a new draw: ${effect.size} cards, keep ${effect.keep}.`;
    case "hand":
      return `, and your hand limit goes up by ${effect.bonus} for the rest of the game.`;
    case "reward":
      return `, and your next completed challenge gives ×${effect.factor} the time bonus and card draws.`;
    case "curseBoost":
      return `, and you gain ${effect.factor}× as much from that curse until it is cleared.`;
    case "replaceChallenge":
      return ". The challenge goes back to the pool and a random one takes its place.";
    case "lockChallenge":
      return ". Only your team can complete that challenge until you do (one lock at a time).";
    case "discardDraw":
      return ".";
    default:
      return ", and your team carries out its effect.";
  }
}
