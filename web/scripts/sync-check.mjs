// Measures how quickly the "game-sync" broadcast reaches a browser after a
// change in the database (see migration 0010). Makes a harmless change: it
// re-saves the game state's "updated_at" with the same value.
//
// Usage (run inside the web folder):
//   node --env-file=.env.local scripts/sync-check.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const viewer = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let received = null;
await new Promise((resolve, reject) => {
  viewer
    .channel("game-sync")
    .on("broadcast", { event: "changed" }, ({ payload }) => {
      if (payload?.table === "game_state" && received === null) received = Date.now();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`Could not connect: ${status}`));
    });
});

const results = [];
for (let i = 0; i < 3; i++) {
  received = null;
  const { data: gs } = await admin.from("game_state").select("updated_at").single();
  const sent = Date.now();
  await admin.from("game_state").update({ updated_at: gs.updated_at }).eq("id", 1);
  await new Promise((r) => setTimeout(r, 3000));
  results.push(received ? received - sent : null);
}

if (results.every((ms) => ms !== null)) {
  console.log(`PASS ✓ sync messages arrived after ${results.join(" ms, ")} ms`);
} else {
  console.log(`FAIL ✗ some sync messages never arrived (${results.map((r) => r ?? "missing").join(", ")}).`);
  console.log("Has migration 0010_sync_broadcast.sql been run? Is Realtime's public access allowed?");
}
process.exit(0);
