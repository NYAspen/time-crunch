// Simultaneous-action test: several teams change speed at the same instant during
// Elimination, over and over. No action should fail with "deadlock detected".
// Each round goes up 1× and back down, so speeds end where they started, but it
// does add lines to the log: run it on a test game, not a real one.
//
// Usage (run inside the web folder, with the game in Elimination and every team
// holding some time):
//   node --env-file=.env.local scripts/race-speed.mjs "Team A" codeA "Team B" codeB ["Team C" codeC ...]
import { createClient } from "@supabase/supabase-js";

const ROUNDS = 25;

const args = process.argv.slice(2);
if (args.length < 4 || args.length % 2 !== 0) {
  console.error('Usage: node --env-file=.env.local scripts/race-speed.mjs "Team A" codeA "Team B" codeB');
  process.exit(1);
}

async function login(name, code) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: team } = await client.from("teams").select("id").eq("name", name).maybeSingle();
  if (!team) throw new Error(`No team called "${name}"`);
  const { error } = await client.auth.signInWithPassword({
    email: `team-${team.id}@example.com`,
    password: code.trim().toLowerCase(),
  });
  if (error) throw new Error(`Login failed for "${name}": ${error.message}`);
  return client;
}

const clients = [];
for (let i = 0; i < args.length; i += 2) clients.push(await login(args[i], args[i + 1]));

const { data: game } = await clients[0].from("game_state").select("phase").eq("id", 1).single();
if (game.phase !== "elimination") {
  console.error("Switch the game to Elimination first: the conflict can only happen then.");
  process.exit(1);
}

let deadlocks = 0;
let otherErrors = 0;
for (let round = 0; round < ROUNDS * 2; round++) {
  const delta = round % 2 === 0 ? 1 : -1;
  const results = await Promise.all(clients.map((c) => c.rpc("step_my_speed", { p_delta: delta })));
  for (const { error } of results) {
    if (!error) continue;
    if (error.code === "40P01") deadlocks++;
    else {
      otherErrors++;
      console.log(`  ${error.message}`);
    }
  }
}

console.log(`${ROUNDS * 2} rounds, ${clients.length} teams: ${deadlocks} deadlocks, ${otherErrors} other errors.`);
console.log(deadlocks === 0 ? "PASS ✓" : "FAIL ✗ simultaneous actions blocked each other");
if (deadlocks + otherErrors > 0) console.log("Check speeds on the admin page: a failed step may have left one off by 1×.");
process.exit(deadlocks === 0 ? 0 : 1);
