// Simultaneous-claim test: two teams (and a double-tap from one team) claim
// the same challenge at the same instant. Exactly one claim must succeed.
// NOTE: each round really claims a challenge on the board (and its time bonus).
//
// Usage (run inside the web folder):
//   node --env-file=.env.local scripts/race-claim.mjs "Team A" codeA "Team B" codeB
import { createClient } from "@supabase/supabase-js";

const [nameA, codeA, nameB, codeB] = process.argv.slice(2);
if (!nameA || !codeA || !nameB || !codeB) {
  console.error('Usage: node --env-file=.env.local scripts/race-claim.mjs "Team A" codeA "Team B" codeB');
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

async function pickChallenge(client) {
  const { data } = await client.from("challenges").select("id, title").eq("status", "active").limit(1);
  if (!data?.length) throw new Error("No challenges on the board. Import some first.");
  return data[0];
}

async function round(label, claims) {
  const results = await Promise.all(claims.map((c) => c.client.rpc("claim_challenge", { p_challenge: c.id })));
  const winners = results.filter((r) => !r.error).length;
  console.log(`\n${label}`);
  results.forEach((r, i) => console.log(`  ${claims[i].who}: ${r.error ? `rejected (${r.error.message})` : "WON"}`));
  console.log(winners === 1 ? "  PASS ✓ exactly one winner" : `  FAIL ✗ ${winners} winners`);
  return winners === 1;
}

const a = await login(nameA, codeA);
const b = await login(nameB, codeB);

const c1 = await pickChallenge(a);
const pass1 = await round(`Round 1: "${nameA}" and "${nameB}" claim "${c1.title}" at once`, [
  { client: a, id: c1.id, who: nameA },
  { client: b, id: c1.id, who: nameB },
]);

const c2 = await pickChallenge(a);
const pass2 = await round(`Round 2: "${nameA}" double-taps "${c2.title}"`, [
  { client: a, id: c2.id, who: `${nameA} (tap 1)` },
  { client: a, id: c2.id, who: `${nameA} (tap 2)` },
]);

const { count } = await a.from("challenges").select("id", { count: "exact", head: true }).eq("status", "active");
console.log(`\nBoard now has ${count} active challenges (should equal the board size if the pool isn't empty).`);

process.exit(pass1 && pass2 ? 0 : 1);
