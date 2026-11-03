import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PublicTeam } from "@/lib/types";

// The logged-in Supabase user id, verified with Supabase (not just trusted from the cookie).
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}

// The team belonging to the logged-in user, or null if they are not a team.
export async function getCurrentTeam(): Promise<PublicTeam | null> {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("teams")
    .select("id, name, status, speed, eliminated_at, hand_bonus")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}
