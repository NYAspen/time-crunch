// Security check: logs in as a TEAM using only the public key (exactly what a
// player's browser has) and tries things a team must never be able to do.
//
// Usage (run inside the web folder):
//   node --env-file=.env.local scripts/rls-check.mjs "Team Name" teamcode
import { createClient } from "@supabase/supabase-js";

const [teamName, code] = process.argv.slice(2);
if (!teamName || !code) {
  console.error('Usage: node --env-file=.env.local scripts/rls-check.mjs "Team Name" teamcode');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const { data: team } = await supabase.from("teams").select("id").eq("name", teamName).maybeSingle();
if (!team) {
  console.error(`No team called "${teamName}".`);
  process.exit(1);
}

const { data: login, error: loginError } = await supabase.auth.signInWithPassword({
  email: `team-${team.id}@example.com`,
  password: code.trim().toLowerCase(),
});
if (loginError) {
  console.error("Login failed:", loginError.message);
  process.exit(1);
}
console.log(`Logged in as team "${teamName}". Trying forbidden actions…\n`);

// Each check returns true if the action was BLOCKED (good).
const checks = [
  ["Change game phase directly", async () => {
    const { data, error } = await supabase.from("game_state").update({ phase: "elimination" }).eq("id", 1).select();
    return !!error || data.length === 0;
  }],
  ["Rename a team", async () => {
    const { data, error } = await supabase.from("teams").update({ name: "HACKED" }).neq("id", "00000000-0000-0000-0000-000000000000").select();
    return !!error || data.length === 0;
  }],
  ["Mark a team eliminated", async () => {
    const { data, error } = await supabase.from("teams").update({ status: "eliminated" }).neq("id", "00000000-0000-0000-0000-000000000000").select();
    return !!error || data.length === 0;
  }],
  ["Call admin_set_phase", async () => {
    const { error } = await supabase.rpc("admin_set_phase", { new_phase: "elimination" });
    return !!error;
  }],
  ["Call admin_set_paused", async () => {
    const { error } = await supabase.rpc("admin_set_paused", { paused: true });
    return !!error;
  }],
  ["Make itself an admin", async () => {
    const { error } = await supabase.from("admins").insert({ user_id: login.user.id });
    return !!error;
  }],
  ["Read the activity log", async () => {
    const { data, error } = await supabase.from("activity_log").select("id").limit(1);
    return !!error || data.length === 0;
  }],
  ["Write to the activity log", async () => {
    const { error } = await supabase.from("activity_log").insert({ event_type: "fake" });
    return !!error;
  }],
  // Stage 2: time
  ["Read another team's clock", async () => {
    const { data, error } = await supabase.from("team_clocks").select("team_id").neq("team_id", team.id);
    return !!error || data.length === 0;
  }],
  ["Read another team's time history", async () => {
    const { data, error } = await supabase.from("time_ledger").select("id").neq("team_id", team.id);
    return !!error || data.length === 0;
  }],
  ["Edit own time balance directly", async () => {
    const { data, error } = await supabase.from("team_clocks").update({ balance_ms: 99999999 }).eq("team_id", team.id).select();
    return !!error || data.length === 0;
  }],
  ["Change own speed directly (bypassing the log)", async () => {
    const { data, error } = await supabase.from("teams").update({ speed: 0 }).eq("id", team.id).select();
    return !!error || data.length === 0;
  }],
  ["Give itself time (admin_adjust_time)", async () => {
    const { error } = await supabase.rpc("admin_adjust_time", { p_team: team.id, delta_seconds: 3600, reason: "hack" });
    return !!error;
  }],
  ["Set a team's speed (admin_set_speed)", async () => {
    const { error } = await supabase.rpc("admin_set_speed", { p_team: team.id, new_speed: 0 });
    return !!error;
  }],
  ["Step a team's speed (admin_step_speed)", async () => {
    const { error } = await supabase.rpc("admin_step_speed", { p_team: team.id, p_delta: -1 });
    return !!error;
  }],
  ["Match a team's speed to its curses (admin_sync_speed)", async () => {
    const { error } = await supabase.rpc("admin_sync_speed", { p_team: team.id });
    return !!error;
  }],
  ["Change the hand limit (admin_set_hand_limit)", async () => {
    const { error } = await supabase.rpc("admin_set_hand_limit", { new_limit: 50 });
    return !!error;
  }],
  ["Undo a claim (admin_undo_claim)", async () => {
    const { error } = await supabase.rpc("admin_undo_claim", { p_challenge: "00000000-0000-0000-0000-000000000000" });
    return !!error && /admin/i.test(error.message);
  }],
  ["Cancel a draw (admin_cancel_draw)", async () => {
    const { error } = await supabase.rpc("admin_cancel_draw", { p_draw: "00000000-0000-0000-0000-000000000000" });
    return !!error && /admin/i.test(error.message);
  }],
  ["Restart a curse (admin_restart_curse)", async () => {
    const { error } = await supabase.rpc("admin_restart_curse", { p_curse: "00000000-0000-0000-0000-000000000000" });
    return !!error && /admin/i.test(error.message);
  }],
  ["Undo an activity log entry (admin_undo_activity)", async () => {
    const { error } = await supabase.rpc("admin_undo_activity", { p_entry: 1 });
    return !!error && /admin/i.test(error.message);
  }],
  ["Undo another team's action (undo_action)", async () => {
    const { error } = await supabase.rpc("undo_action", { p_undo: "00000000-0000-0000-0000-000000000000" });
    return !!error;
  }],
  ["Revive or eliminate a team (admin_set_team_status)", async () => {
    const { error } = await supabase.rpc("admin_set_team_status", { p_team: team.id, new_status: "eliminated" });
    return !!error;
  }],
  ["Undo a history entry (admin_reverse_entry)", async () => {
    const { error } = await supabase.rpc("admin_reverse_entry", { entry_id: 1 });
    return !!error;
  }],
  ["Call an internal helper (_settle_team)", async () => {
    const { error } = await supabase.rpc("_settle_team", { p_team: team.id });
    return !!error;
  }],
  // Stage 3: challenges
  ["See hidden pool challenges", async () => {
    const { data, error } = await supabase.from("challenges").select("id").in("status", ["pool", "retired"]);
    return !!error || data.length === 0;
  }],
  ["Mark a challenge claimed directly", async () => {
    const { data, error } = await supabase.from("challenges").update({ status: "claimed", claimed_by: team.id }).eq("status", "active").select();
    return !!error || data.length === 0;
  }],
  ["Add a challenge (admin_import_challenges)", async () => {
    const { error } = await supabase.rpc("admin_import_challenges", { p_rows: [{ title: "hack", task: "", reward_cards: 9, reward_minutes: 600 }] });
    return !!error;
  }],
  ["Change board size (admin_set_board_size)", async () => {
    const { error } = await supabase.rpc("admin_set_board_size", { new_size: 1 });
    return !!error;
  }],
  // Stage 4: cards
  ["See another team's cards or the deck", async () => {
    const { data, error } = await supabase.from("cards").select("id").or(`holder_team.is.null,holder_team.neq.${team.id}`);
    return !!error || data.length === 0;
  }],
  ["See another team's card draws", async () => {
    const { data, error } = await supabase.from("card_draws").select("id").neq("team_id", team.id);
    return !!error || data.length === 0;
  }],
  ["Take a card from the deck directly", async () => {
    const { data, error } = await supabase.from("cards").update({ status: "hand", holder_team: team.id }).eq("status", "deck").select();
    return !!error || data.length === 0;
  }],
  ["Give itself a card draw directly", async () => {
    const { error } = await supabase.from("card_draws").insert({ team_id: team.id, size: 10 });
    return !!error;
  }],
  ["Give itself a card draw (admin_grant_draw)", async () => {
    const { error } = await supabase.rpc("admin_grant_draw", { p_team: team.id, p_size: 10 });
    return !!error;
  }],
  ["Move a card (admin_move_card)", async () => {
    const { error } = await supabase.rpc("admin_move_card", { p_card: "00000000-0000-0000-0000-000000000000", p_team: team.id });
    return !!error;
  }],
  // Stage 5: curses and resets
  ["See curses between other teams", async () => {
    const { data, error } = await supabase
      .from("curses")
      .select("id")
      .neq("attacker_team", team.id)
      .neq("target_team", team.id);
    return !!error || data.length === 0;
  }],
  ["Create a curse directly (without a card)", async () => {
    const { error } = await supabase.from("curses").insert({ attacker_team: team.id, target_team: team.id, card_name: "hack" });
    return !!error;
  }],
  ["Clear a curse that isn't on it", async () => {
    const { error } = await supabase.rpc("clear_curse", { p_curse: "00000000-0000-0000-0000-000000000000" });
    return !!error;
  }],
  ["Reset the game (admin_reset_game)", async () => {
    const { error } = await supabase.rpc("admin_reset_game");
    return !!error;
  }],
  ["Delete all challenges (admin_delete_all_challenges)", async () => {
    const { error } = await supabase.rpc("admin_delete_all_challenges");
    return !!error;
  }],
  ["Delete all cards (admin_delete_all_cards)", async () => {
    const { error } = await supabase.rpc("admin_delete_all_cards");
    return !!error;
  }],
  ["Use a card it doesn't hold", async () => {
    const { error } = await supabase.rpc("use_card", { p_card: "00000000-0000-0000-0000-000000000000", p_target: null });
    return !!error;
  }],
  // Power-ups (0015)
  ["See steals between other teams", async () => {
    const { data, error } = await supabase
      .from("steals")
      .select("id")
      .neq("attacker_team", team.id)
      .neq("target_team", team.id);
    return !!error || data.length === 0;
  }],
  ["Record a steal directly (without a card)", async () => {
    const { error } = await supabase
      .from("steals")
      .insert({ attacker_team: team.id, target_team: team.id, card_name: "hack", veto_until: new Date().toISOString() });
    return !!error;
  }],
  ["Raise its own hand limit directly", async () => {
    const { data, error } = await supabase.from("teams").update({ hand_bonus: 50 }).eq("id", team.id).select();
    return !!error || data.length === 0;
  }],
  ["Pay to veto a curse that isn't on it", async () => {
    const { error } = await supabase.rpc("veto_curse_for_time", { p_curse: "00000000-0000-0000-0000-000000000000" });
    return !!error;
  }],
  // 0022: speeds are private, and codes are admin only.
  ["See teams' speeds", async () => {
    const { error } = await supabase.from("teams").select("speed");
    return !!error;
  }],
  ["See another team's speed on its clock", async () => {
    const { data, error } = await supabase.from("team_clocks").select("speed").neq("team_id", team.id);
    return !!error || data.length === 0;
  }],
  ["Read team codes", async () => {
    const { data, error } = await supabase.from("team_codes").select("code");
    return !!error || data.length === 0;
  }],
  ["Write a team code", async () => {
    const { error } = await supabase.from("team_codes").upsert({ team_id: team.id, code: "hacked" });
    return !!error;
  }],
  // Notifications (0020): the feed must never show other teams' private moves.
  ["See other teams' private moves in its notifications", async () => {
    const { data, error } = await supabase.rpc("team_feed");
    if (error) return true;
    const privateMoves = ["card_kept", "cards_drawn", "card_discarded", "speed_changed", "time_adjusted"];
    return !data.some((e) => e.team_id !== team.id && privateMoves.includes(e.event_type));
  }],
];

let failures = 0;
for (const [label, check] of checks) {
  const blocked = await check();
  if (!blocked) failures++;
  console.log(`${blocked ? "BLOCKED ✓" : "ALLOWED ✗ (SECURITY PROBLEM)"}  ${label}`);
}

await supabase.auth.signOut();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
