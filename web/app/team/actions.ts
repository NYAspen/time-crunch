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
