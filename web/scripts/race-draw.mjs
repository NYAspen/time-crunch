// Simultaneous-draw test: two teams reveal a draw at the same instant.
// No card copy may be offered to both teams, and keeping one card must put
// the others back in the deck. Gives each team a test draw of 3 first.
// NOTE: each team ends up keeping one real card from the deck.
//
// Usage (run inside the web folder):
//   node --env-file=.env.local scripts/race-draw.mjs "Team A" codeA "Team B" codeB
import { createClient } from "@supabase/supabase-js";

const [nameA, codeA, nameB, codeB] = process.argv.slice(2);
if (!nameA || !codeA || !nameB || !codeB) {
  console.error('Usage: node --env-file=.env.local scripts/race-draw.mjs "Team A" codeA "Team B" codeB');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function login(name, code) {
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: team } = await client.from("teams").select("id").eq("name", name).maybeSingle();
  if (!team) throw new Error(`No team called "${name}"`);
  const { error } = await client.auth.signInWithPassword({
    email: `team-${team.id}@example.com`,
    password: code.trim().toLowerCase(),
  });
  if (error) throw new Error(`Login failed for "${name}": ${error.message}`);
  return { client, id: team.id, name };
}

const countDeck = async () =>
  (await admin.from("cards").select("id", { count: "exact", head: true }).eq("status", "deck")).count;

const a = await login(nameA, codeA);
const b = await login(nameB, codeB);

for (const t of [a, b]) {
  const { data: open } = await admin.from("card_draws").select("id").eq("team_id", t.id).eq("status", "open");
  if (open.length) throw new Error(`"${t.name}" already has cards showing. Pick one in the app first.`);
}

const deckBefore = await countDeck();
if (deckBefore < 6) throw new Error(`The deck only has ${deckBefore} cards; import at least 6 first.`);

// Test draws, created so they are each team's oldest waiting draw.
await admin.from("card_draws").insert([
  { team_id: a.id, size: 3, source: "race test", created_at: "2000-01-01T00:00:00Z" },
  { team_id: b.id, size: 3, source: "race test", created_at: "2000-01-01T00:00:00Z" },
]);

const [ra, rb] = await Promise.all([a.client.rpc("open_draw"), b.client.rpc("open_draw")]);
if (ra.error || rb.error) throw new Error(`open_draw failed: ${ra.error?.message ?? rb.error?.message}`);

const offered = async (t) =>
  (await t.client.from("cards").select("id").eq("status", "offered").eq("holder_team", t.id)).data.map((c) => c.id);
const offA = await offered(a);
const offB = await offered(b);
const overlap = offA.filter((id) => offB.includes(id));
console.log(`"${nameA}" was shown ${offA.length} cards, "${nameB}" ${offB.length}.`);
const pass1 = overlap.length === 0 && offA.length === 3 && offB.length === 3;
console.log(pass1 ? "PASS ✓ no card shown to both teams" : `FAIL ✗ ${overlap.length} card(s) shown to both`);

await Promise.all([
  a.client.rpc("choose_card", { p_card: offA[0] }),
  b.client.rpc("choose_card", { p_card: offB[0] }),
]);
const deckAfter = await countDeck();
const pass2 = deckAfter === deckBefore - 2;
console.log(
  pass2
    ? `PASS ✓ each team kept 1 card and the other 4 went back (deck ${deckBefore} -> ${deckAfter})`
    : `FAIL ✗ deck went ${deckBefore} -> ${deckAfter} (expected ${deckBefore - 2})`,
);

process.exit(pass1 && pass2 ? 0 : 1);
