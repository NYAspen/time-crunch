"use client";

import { useActionState, useState, useTransition } from "react";
import { CardView } from "@/components/CardView";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { DeleteAllButton } from "@/components/DeleteAllButton";
import { refreshAllLiveTables, useLiveTable, withRefresh } from "@/components/useLiveTable";
import { loadCardDraws, loadCards, loadCardTypes, loadTeams } from "@/lib/queries";
import type { ActionResult, Card, CardType, PublicTeam } from "@/lib/types";
import { changeCopies, deleteAllCards, grantDraw, importCards, moveCard, updateCardType } from "./adminActions";
import { Notice } from "@/components/Notice";

const EXAMPLE =
  "name\ttype\tcopies\tdescription\trange\tclearance\teffect\n" +
  "Slow Down\tcurse\t2\tTarget counts down at 2x until cleared\t500 m\tSing in public\t\n" +
  "Copycat\tpowerup\t2\tDuplicate another card in your hand\t\t\tduplicate";

export function CardManager() {
  const { data: types, error } = useLiveTable("card_types", loadCardTypes);
  const { data: cards } = useLiveTable("cards", loadCards);
  const { data: draws } = useLiveTable("card_draws", loadCardDraws);
  const { data: teams } = useLiveTable("teams", loadTeams);
  const [importResult, importAction, importing] = useActionState(withRefresh(importCards), null);
  const [drawResult, drawAction, granting] = useActionState(withRefresh(grantDraw), null);

  if (error) return <p className="text-red-700">Error: {error}</p>;
  if (!types || !cards || !draws || !teams) return <p className="text-gray-500">Loading cards…</p>;

  const inDeck = cards.filter((c) => c.status === "deck");
  const inPlay = cards.filter((c) => c.status === "hand" || c.status === "offered");
  const typeOf = (card: Card) => types.find((t) => t.id === card.type_id);

  return (
    <CollapsibleSection
      title="Cards"
      summary={`${inDeck.length} in deck · ${inPlay.length} held · ${draws.length} draws waiting`}
    >
      {inDeck.length === 0 && types.length > 0 && (
        <p className="rounded-lg bg-yellow-100 p-2 text-sm text-yellow-900">
          The deck is empty, so teams can&apos;t draw. Add copies or wait for cards to be used.
        </p>
      )}

      <details className="rounded-lg bg-gray-50 p-3">
        <summary className="font-medium">Import cards</summary>
        <form action={importAction} className="mt-2 space-y-2">
          <p className="text-sm text-gray-600">
            Paste rows from Google Sheets, header row included. Columns:{" "}
            <code>name, type, copies, description, range, clearance, effect</code>. Type is <code>curse</code> or{" "}
            <code>powerup</code>. Leave effect blank for cards the players carry out themselves, or put{" "}
            <code>duplicate</code> for &quot;copy another card in your hand&quot;.
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

      <details>
        <summary className="font-medium">Cards held by teams ({inPlay.length})</summary>
        <div className="mt-2 space-y-3">
          {teams.map((team) => {
            const held = inPlay.filter((c) => c.holder_team === team.id);
            return held.length ? (
              <div key={team.id}>
                <div className="text-sm font-semibold">{team.name}</div>
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
