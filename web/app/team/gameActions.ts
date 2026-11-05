// Team game actions. These call the database functions DIRECTLY from the
// phone (no trip through the Vercel server), which keeps the game fast. Each
// database function checks who is calling, so this is just as secure: a team
// can only ever act as itself, on its own cards, while it is active.
import { drawLabel } from "@/components/ChallengeRewards";
import { createClient } from "@/lib/supabase/client";
import type { ActionResult } from "@/lib/types";

// Moves the caller's own speed up or down (the arrows send several taps as one
// change). The database function checks that the caller is an active team.
export async function stepMySpeed(delta: number): Promise<{ result: ActionResult; speed: number | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("step_my_speed", { p_delta: delta });
  if (error) return { result: { ok: false, message: error.message }, speed: null };
  return { result: { ok: true, message: `Countdown speed set to ${data}×.` }, speed: data as number };
}

// Sets the caller's speed to what its active curses add up to (worked out in
// the database).
export async function syncMySpeed(): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("sync_my_speed");
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Countdown speed now matches your curses." };
}

// The database function locks the challenge, so only the first claim wins.
export async function claimChallenge(challengeId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("claim_challenge", { p_challenge: challengeId });
  if (error) return { ok: false, message: error.message };

  const { title, minutes, cards, keep, draws, multiplier } = data as {
    title: string;
    minutes: number;
    cards: number;
    keep?: number;
    draws?: number; // several when a "reward xN" was waiting
    multiplier?: number;
  };
  const drawCount = draws ?? 1;
  const rewards = [
    minutes > 0 ? `+${minutes} min` : null,
    cards > 0
      ? `${drawCount > 1 ? `${drawCount} × ` : ""}${drawLabel(cards, keep)} (open the Cards tab to draw)`
      : null,
  ].filter(Boolean);
  const boosted = multiplier && multiplier > 1 ? ` Reward ×${multiplier}:` : "";
  return { ok: true, message: `You completed "${title}"!${boosted}${rewards.length ? ` ${rewards.join(", ")}.` : ""}` };
}

// ---------------------------------------------------------------------------
// Cards (each database function checks the caller is an active team and only
// touches that team's own cards)
// ---------------------------------------------------------------------------

export async function openDraw(): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_draw");
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Pick one card to keep." };
}

export async function chooseCard(cardId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("choose_card", { p_card: cardId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Card added to your hand." };
}

export async function playCard(
  cardId: string,
  options: {
    targetCardId?: string; // duplicate: the card to copy
    targetTeamId?: string; // curse / steal / curse copy
    inRange?: boolean;
    curseId?: string; // curse xN / curse copy: one of your active curses
    challengeId?: string; // replace / lock challenge
    cardIds?: string[]; // discard X draw Y: the cards to discard
  } = {},
): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("use_card", {
    p_card: cardId,
    p_target: options.targetCardId ?? null,
    p_target_team: options.targetTeamId ?? null,
    p_in_range: options.inRange ?? false,
    p_curse: options.curseId ?? null,
    p_challenge: options.challengeId ?? null,
    p_cards: options.cardIds ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Card used." };
}

export async function discardCard(cardId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("discard_card", { p_card: cardId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Card discarded back into the deck." };
}

// Undo one of the team's own actions from the last 60 seconds (checked in the
// database).
export async function undoAction(undoId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("undo_action", { p_undo: undoId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Undone." };
}

// Only the cursed team can clear its own curse (checked in the database).
export async function clearCurse(curseId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clear_curse", { p_curse: curseId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Curse cleared." };
}

// Veto: the database finds a Veto card in the team's hand and checks the
// curse is on this team.
export async function vetoCurse(curseId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("veto_curse", { p_curse: curseId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Curse vetoed." };
}

// Veto without a card: the database moves 30 minutes to the team that played
// the curse, and refuses if this team has less than 30 minutes left.
export async function vetoCurseForTime(curseId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("veto_curse_for_time", { p_curse: curseId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Curse vetoed." };
}
