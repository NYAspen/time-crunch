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
    cards > 0 ? `${cards} card draw${cards === 1 ? "" : "s"} (cards will be added once the deck is set up)` : null,
  ].filter(Boolean);
  return { ok: true, message: `You claimed "${title}"!${rewards.length ? ` ${rewards.join(", ")}.` : ""}` };
}
