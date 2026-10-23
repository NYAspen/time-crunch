import { createClient } from "@/lib/supabase/client";
import type { ActivityLogEntry, GameState, PublicTeam } from "@/lib/types";

// Browser-side reads. RLS decides what each user is allowed to see.

export async function loadGameState(): Promise<GameState> {
  const { data, error } = await createClient()
    .from("game_state")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadTeams(): Promise<PublicTeam[]> {
  const { data, error } = await createClient()
    .from("teams")
    .select("id, name, status")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function loadActivityLog(): Promise<ActivityLogEntry[]> {
  const { data, error } = await createClient()
    .from("activity_log")
    .select("id, created_at, team_id, event_type, details")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data;
}
