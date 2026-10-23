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
    const { data, error } = await supabase.from("game_state").update({ phase: "ended" }).eq("id", 1).select();
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
    const { error } = await supabase.rpc("admin_set_phase", { new_phase: "ended" });
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
