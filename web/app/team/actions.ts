"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Speed } from "@/lib/types";

// The database function checks that the caller is an active team and only
// ever changes the caller's own speed.
export async function setMySpeed(speed: Speed): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_speed", { new_speed: speed });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Countdown speed set to ${speed}×.` };
}

// The database function locks the challenge, so only the first claim wins.
export async function claimChallenge(challengeId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_challenge", { p_challenge: challengeId });
  if (error) return { ok: false, message: error.message };

  const { title, minutes, cards } = data as { title: string; minutes: number; cards: number };
  const rewards = [
    minutes > 0 ? `+${minutes} min` : null,
    cards > 0 ? `a draw of ${cards} card${cards === 1 ? "" : "s"} (open "Your cards" to pick one)` : null,
  ].filter(Boolean);
  return { ok: true, message: `You claimed "${title}"!${rewards.length ? ` ${rewards.join(", ")}.` : ""}` };
}

// ---------------------------------------------------------------------------
// Cards (each database function checks the caller is an active team and only
// touches that team's own cards)
// ---------------------------------------------------------------------------

export async function openDraw(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_draw");
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Pick one card to keep." };
}

export async function chooseCard(cardId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("choose_card", { p_card: cardId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? `${data} added to your hand.` : "Card added to your hand." };
}

export async function playCard(cardId: string, targetCardId?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("use_card", { p_card: cardId, p_target: targetCardId ?? null });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? String(data) : "Card used." };
}

export async function discardCard(cardId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_card", { p_card: cardId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Card discarded back into the deck." };
}
