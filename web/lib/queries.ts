import { createClient } from "@/lib/supabase/client";
import type {
  ActivityLogEntry,
  Card,
  CardDraw,
  CardType,
  Challenge,
  Curse,
  GameState,
  LedgerEntry,
  PublicTeam,
  TeamClock,
  TeamUndo,
} from "@/lib/types";

// Browser-side reads. RLS decides what each user is allowed to see.

export async function loadGameState(): Promise<GameState> {
  const { data, error } = await createClient().from("game_state").select("*").eq("id", 1).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadTeams(): Promise<PublicTeam[]> {
  const { data, error } = await createClient()
    .from("teams")
    .select("id, name, status, speed, eliminated_at")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

// Teams only get their own clock back (RLS); admins get every team's.
export async function loadClocks(): Promise<TeamClock[]> {
  const { data, error } = await createClient()
    .from("team_clocks")
    .select("team_id, balance_ms, anchor_at, speed, running");
  if (error) throw new Error(error.message);
  return data;
}

// Teams only get their own history back (RLS); admins get everything.
export async function loadLedger(): Promise<LedgerEntry[]> {
  const { data, error } = await createClient()
    .from("time_ledger")
    .select("id, created_at, team_id, kind, delta_ms, balance_after_ms, reason, details, reversed_by")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

export async function loadActivityLog(): Promise<ActivityLogEntry[]> {
  const { data, error } = await createClient()
    .from("activity_log")
    .select("id, created_at, team_id, event_type, details, undone_at")
    .order("id", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data;
}

// Teams get the board and claimed challenges (RLS); admins also get the pool.
export async function loadChallenges(): Promise<Challenge[]> {
  const { data, error } = await createClient()
    .from("challenges")
    .select("id, title, task, reward_cards, reward_minutes, status, activated_at, claimed_by, claimed_at")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function loadCardTypes(): Promise<CardType[]> {
  const { data, error } = await createClient()
    .from("card_types")
    .select("id, name, type, description, range_text, clearance, effect")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

// Teams only get the copies they hold (RLS); admins get every copy.
export async function loadCards(): Promise<Card[]> {
  const { data, error } = await createClient()
    .from("cards")
    .select("id, type_id, status, holder_team, draw_id, is_duplicate")
    .neq("status", "removed")
    .order("updated_at");
  if (error) throw new Error(error.message);
  return data;
}

// Teams only get their own draws (RLS); admins get everyone's.
export async function loadCardDraws(): Promise<CardDraw[]> {
  const { data, error } = await createClient()
    .from("card_draws")
    .select("id, team_id, size, source, status, created_at")
    .neq("status", "done")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

// Recent actions not yet undone; the screen hides the expired ones using the
// server clock.
export async function loadUndos(): Promise<TeamUndo[]> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await createClient()
    .from("team_undos")
    .select("id, team_id, kind, label, created_at, expires_at")
    .is("undone_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// Active curses plus those cleared in the last hour (so teams are reminded to
// reset their speed).
export async function loadCurses(): Promise<Curse[]> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await createClient()
    .from("curses")
    .select("id, attacker_team, target_team, card_name, range_text, clearance, status, started_at, cleared_at")
    .or(`status.eq.active,cleared_at.gte.${since}`)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
