"use client";

import { useActionState, useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { drawLabel } from "@/components/ChallengeRewards";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { DeleteAllButton } from "@/components/DeleteAllButton";
import { refreshAllLiveTables, useLiveTable, withRefresh } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadGameState, loadTeams } from "@/lib/queries";
import type { ActionResult, Card, CardDraw, CardType, PublicTeam } from "@/lib/types";
import {
  cancelDraw,
  changeCopies,
  deleteAllCards,
  grantDraw,
  importCards,
  moveCard,
  setHandLimit,
  updateCardType,
} from "./adminActions";
import { Notice } from "@/components/Notice";
import { SignBox } from "@/components/SignBox";

const EXAMPLE =
  "name\ttype\tcopies\tdescription\trange\tclearance\teffect\n" +
  "Slow Down\tcurse\t2\tTarget counts down at 2x until cleared\t500 m\tSing in public\t\n" +
  "Copycat\tpowerup\t2\tDuplicate another card in your hand\t\t\tduplicate";

export function CardManager() {
  const { data: types, error } = useLiveTable("card_types", loadCardTypes);
  const { data: cards } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const { data: game } = useLiveTable("game_state", loadGameState);
  const [limitResult, limitAction, limiting] = useActionState(withRefresh(setHandLimit), null);
  const [importResult, importAction, importing] = useActionState(withRefresh(importCards), null);
  const [drawResult, drawAction, granting] = useActionState(withRefresh(grantDraw), null);

  if (error) return <p className="text-red-700">Error: {error}</p>;
  if (!types || !cards || !draws || !teams || !game) return <p className="text-gray-500">Loading cards…</p>;

  const inDeck = cards.filter((c) => c.status === "deck");
  const inPlay = cards.filter((c) => c.status === "hand" || c.status === "offered");
  const typeOf = (card: Card) => types.find((t) => t.id === card.type_id);

  return (
    <CollapsibleSection
      title="Cards"
      summary={`${inDeck.length} in deck · ${inPlay.length} held · hand limit ${game.hand_limit}`}
    >
      {inDeck.length === 0 && types.length > 0 && (
        <SignBox tone="yellow" compact title="Note">
          <p>The deck is empty, so teams can&apos;t draw. Add copies or wait for cards to be used.</p>
        </SignBox>
      )}

      <form action={limitAction} className="flex items-center gap-2">
        <label className="text-sm">Hand limit (cards per team):</label>
        <input
          key={game.hand_limit}
          name="limit"
          type="number"
          min={1}
          max={50}
          defaultValue={game.hand_limit}
          className="w-20 rounded border p-2"
        />
        <button disabled={limiting} className="rounded bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-50">
          Set
        </button>
      </form>
      <Notice compact result={limitResult} />

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Import cards</summary>
        <form action={importAction} className="mt-2 space-y-2">
          <p className="text-sm text-gray-600">
            Paste rows from Google Sheets, header row included. Columns:{" "}
            <code>name, type, copies, description, range, clearance, effect</code>. Type is <code>curse</code> or{" "}
            <code>powerup</code>. Leave effect blank for cards the players carry out themselves, or put one of:{" "}
            <code>duplicate</code> (copy another card in your hand), <code>steal</code> (take a random card from
            another team, Elimination only), <code>veto</code> (cancel a curse on you, or take back a stolen card
            within 60 s), <code>draw 4 pick 2</code> (a new draw), <code>hand +1</code> (hand limit +1 for the rest
            of the game), <code>reward x2</code> (next completed challenge gives ×2 time and draws),{" "}
            <code>curse x2</code> (you gain 2× from one of your curses), <code>curse copy</code> (put one of your
            curses on a second team), <code>discard 2 draw 3</code>, <code>replace challenge</code> (swap one on the
            board for a random one), <code>lock challenge</code> (only your team can complete it). The ×N ones
            don&apos;t stack.
          </p>
          <textarea
            name="table"
            rows={6}
            placeholder={EXAMPLE}
            className="w-full rounded border p-2 font-mono text-xs"
          />
          <button
            disabled={importing}
            className="w-full rounded bg-blue-600 p-2 font-semibold text-white disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <Notice compact result={importResult} />
        </form>
      </details>

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Give a team a card draw</summary>
        <form action={drawAction} className="mt-2 flex flex-wrap gap-2">
          <select name="team" required defaultValue="" className="min-w-0 flex-1 rounded border bg-white p-2">
            <option value="" disabled>
              Team…
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input name="size" type="number" min={1} max={10} defaultValue={3} className="w-16 rounded border p-2" />
          <button disabled={granting} className="rounded bg-gray-800 px-3 text-sm text-white disabled:opacity-50">
            Give
          </button>
        </form>
        <Notice compact result={drawResult} />
      </details>

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Give a team a card from the deck</summary>
        <GiveFromDeck types={types} inDeck={inDeck} teams={teams} />
      </details>

      <details>
        <summary className="font-medium">Waiting draws ({draws.length})</summary>
        <ul className="mt-2 space-y-1">
          {draws.length === 0 && <li className="text-sm text-gray-500">No draws waiting.</li>}
          {draws.map((d) => (
            <DrawRow key={d.id} draw={d} teamName={teams.find((t) => t.id === d.team_id)?.name ?? "?"} />
          ))}
        </ul>
      </details>

      <details>
        <summary className="font-medium">Cards held by teams ({inPlay.length})</summary>
        <div className="mt-2 space-y-3">
          {teams.map((team) => {
            const held = inPlay.filter((c) => c.holder_team === team.id);
            const inHand = held.filter((c) => c.status === "hand").length;
            const limit = game.hand_limit + team.hand_bonus;
            return held.length ? (
              <div key={team.id}>
                <div className="text-sm font-semibold">
                  {team.name}{" "}
                  <span className={inHand > limit ? "text-red-700" : "font-normal text-gray-500"}>
                    ({inHand}/{limit}
                    {team.hand_bonus > 0 ? ` incl. +${team.hand_bonus} bonus` : ""}
                    {inHand > limit ? ", over the limit" : ""})
                  </span>
                </div>
                <ul className="space-y-1">
                  {held.map((card) => (
                    <HeldCardRow key={card.id} card={card} cardType={typeOf(card)} teams={teams} />
                  ))}
                </ul>
              </div>
            ) : null;
          })}
          {inPlay.length === 0 && <p className="text-sm text-gray-500">No team holds any cards.</p>}
        </div>
      </details>

      <details>
        <summary className="font-medium">Card types ({types.length})</summary>
        <ul className="mt-2 space-y-2">
          {types.length === 0 && <li className="text-sm text-gray-500">None yet. Import some above.</li>}
          {types.map((t) => (
            <CardTypeRow
              key={t.id}
              cardType={t}
              deckCount={inDeck.filter((c) => c.type_id === t.id).length}
              heldCount={inPlay.filter((c) => c.type_id === t.id).length}
            />
          ))}
        </ul>
      </details>
      <DeleteAllButton
        label="Delete all cards"
        warning="This permanently deletes every card type and every copy, including cards in teams' hands. Waiting draws are kept. Use this before importing a new deck."
        action={deleteAllCards}
      />
    </CollapsibleSection>
  );
}

// Undo a use or discard: hand a specific card type from the deck to a team.
function GiveFromDeck({ types, inDeck, teams }: { types: CardType[]; inDeck: Card[]; teams: PublicTeam[] }) {
  const [typeId, setTypeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();
  const available = types.filter((t) => inDeck.some((c) => c.type_id === t.id));

  const give = () =>
    startTransition(async () => {
      const card = inDeck.find((c) => c.type_id === typeId);
      setResult(card ? await moveCard(card.id, teamId) : { ok: false, message: "No copy of that card is in the deck." });
      setTypeId("");
      refreshAllLiveTables();
    });

  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-gray-600">
        Use this to give back a card that was used or discarded by mistake. It goes straight into the team&apos;s hand.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-white p-2"
        >
          <option value="">Card…</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({inDeck.filter((c) => c.type_id === t.id).length} in deck)
            </option>
          ))}
        </select>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-white p-2"
        >
          <option value="">Team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          disabled={pending || !typeId || !teamId}
          onClick={give}
          className="rounded bg-gray-800 px-3 text-sm text-white disabled:opacity-40"
        >
          Give
        </button>
      </div>
      <Notice compact result={result} />
    </div>
  );
}

function DrawRow({ draw, teamName }: { draw: CardDraw; teamName: string }) {
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const cancel = () =>
    startTransition(async () => {
      setResult(await cancelDraw(draw.id));
      refreshAllLiveTables();
    });

  return (
    <li className="rounded border p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <b>{teamName}</b>: {drawLabel(draw.size, draw.keep)} ({draw.source})
          {draw.status === "open" && <span className="text-purple-700"> (cards showing)</span>}
        </span>
        <button
          disabled={pending}
          onClick={cancel}
          className="rounded border bg-white px-2 py-1 disabled:opacity-50"
        >
          Cancel draw
        </button>
      </div>
      <Notice compact result={result} />
    </li>
  );
}

function HeldCardRow({ card, cardType, teams }: { card: Card; cardType?: CardType; teams: PublicTeam[] }) {
  const [destination, setDestination] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const move = () =>
    startTransition(async () => {
      setResult(await moveCard(card.id, destination === "deck" ? null : destination));
      setDestination("");
      refreshAllLiveTables();
    });

  return (
    <li className="rounded border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          {cardType?.name ?? "?"}
          {card.is_duplicate && <span className="text-gray-500"> (copy)</span>}
          {card.status === "offered" && <span className="text-purple-700"> (being chosen)</span>}
        </span>
        {card.status === "hand" && (
          <>
            <select value={destination} onChange={(e) => setDestination(e.target.value)} className="rounded border p-1">
              <option value="">Move to…</option>
              <option value="deck">Back to deck</option>
              {teams
                .filter((t) => t.id !== card.holder_team)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <button
              disabled={pending || !destination}
              onClick={move}
              className="rounded bg-gray-800 px-2 py-1 text-white disabled:opacity-40"
            >
              Move
            </button>
          </>
        )}
      </div>
      <Notice compact result={result} />
    </li>
  );
}

function CardTypeRow({ cardType, deckCount, heldCount }: { cardType: CardType; deckCount: number; heldCount: number }) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (r?.ok) setEditing(false);
      refreshAllLiveTables();
    });

  return (
    <li className="space-y-2">
      <CardView cardType={cardType}>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          <span className="flex-1">
            {deckCount} in deck · {heldCount} held
            {cardType.effect && <span className="text-gray-500"> · automatic: {cardType.effect}</span>}
          </span>
          <button
            disabled={pending}
            onClick={() => run(() => changeCopies(cardType.id, -1))}
            className="rounded border bg-white px-2"
          >
            −1
          </button>
          <button
            disabled={pending}
            onClick={() => run(() => changeCopies(cardType.id, 1))}
            className="rounded border bg-white px-2"
          >
            +1
          </button>
          <button onClick={() => setEditing(!editing)} className="rounded border bg-white px-2">
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </CardView>
      {editing && (
        <form action={(fd) => run(() => updateCardType(cardType.id, fd))} className="space-y-2 rounded-lg border p-2">
          <input
            name="name"
            defaultValue={cardType.name}
            required
            maxLength={60}
            className="w-full rounded border p-2"
          />
          <textarea
            name="description"
            defaultValue={cardType.description}
            rows={2}
            className="w-full rounded border p-2"
          />
          <input
            name="range"
            defaultValue={cardType.range_text}
            placeholder="Range"
            className="w-full rounded border p-2"
          />
          <input
            name="clearance"
            defaultValue={cardType.clearance}
            placeholder="Clearance task"
            className="w-full rounded border p-2"
          />
          <button disabled={pending} className="w-full rounded bg-gray-800 p-2 text-sm text-white disabled:opacity-50">
            Save
          </button>
        </form>
      )}
      <Notice compact result={result} />
    </li>
  );
}
