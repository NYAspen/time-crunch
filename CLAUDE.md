# Project: Jet Lag: Chicago — Time Crunch

A simple, mobile-friendly website for running a team-based game in Chicago.

**Source of truth:** the "Time Crunch: Tech Requirements" spec (Tier 1/2/3), summarised in sections 1–4. Where the spec doesn't say something the build needs, this file uses a **working default (D#)** from section 3. Each default can be confirmed or changed; changes go in the decisions log (section 9).

## 1. Deadlines and how we work

- **Game day: Saturday, November 7, 2026.**
- **Tier 1 working by about November 1**, so there is time to playtest and change things.
- Reliable core functions first; automation and convenience features as time allows.
- **Minimise admin work.** Teams do their own game actions: claim, draw, use cards, start and clear curses. The admin's jobs are:
  - setup
  - the single switch to Elimination
  - pause/resume
  - correcting mistakes

  Every team action must still be checked by the server and be reversible by the admin.
- Simple, clear controls are fine for a first version, as long as they are clear, consistent and recoverable.
- Game state must survive refreshing or closing the page.
- Team identification and clear instructions are needed from the start; polish can come later.
- For future seasons, keep:
  - the source code
  - the content format
  - the setup instructions
  - a way to create a fresh test game
- Any AI tools may be used, but everything must be tested before game day.

The user has limited web-development experience. For each step:
1. Say exactly what to do: commands, where to run them, accounts, env vars and dashboard settings.
2. Build one small, working feature at a time. Never dump the whole app at once.
3. Explain how to test it, and help debug before moving on.

Keep explanations short and practical, with no jargon. When something is ambiguous, name it and propose a simple default before building. Flag dependencies and anything unlikely to be ready early. Keep section 9 up to date.

## 2. Timeline

| Dates | Goal |
|---|---|
| Oct 22 | ✅ Stage 1: setup, team identification, shared phase and pause, deployed |
| Oct 22 | ✅ Stage 2: team time pools, countdowns, speed toggle, balance history |
| Oct 22 | ✅ Stage 3: shared challenge board |
| Oct 22 | ✅ Stage 4: shared card deck and team hands |
| Oct 23 | ✅ Stage 5: curses (automatic speeds), reset game, delete-all. Next: UI adjustments, then the full-loop test on phones |
| **Nov 1** | **Tier 1 complete** |
| Nov 2–3 | Short field playtest, then fix problems |
| Nov 3–5 | Tier 2, only if Tier 1 is solid |
| Nov 5–6 | Final rehearsal with real content, then reset to a fresh game |
| **Nov 7** | **Game day** |

**The full loop to build and test first:** claim a challenge → draw a card → gain time → start countdown → record an attack and transfer → clear the curse. Test it with several teams on phones, including simultaneous claims and page refreshes. Fix problems before starting Tier 2.

## 3. Game rules

### From the spec
- **Phases:** there are two.
  - **Preparation** (morning): teams build up time. No countdown runs.
  - **Elimination** (after lunch): countdowns run.
  - Lunch is not a phase. The game is **paused** over lunch.
- **Time:** time can be added and subtracted, the game can be paused and resumed, and a team that reaches zero is identified.
- **Challenges:** there is a shared board. Each challenge has a reward of **card draws plus a time bonus**. (The spec's "where it can be completed" was removed on 2026-10-22.) A completed challenge is claimed, recorded against the claiming team, and replaced. Duplicate rewards must be prevented.
- **Cards:** there is one common pool of individual copies of **time cards, curses and power-ups**. If the deck has two copies of a curse, only those two can be drawn until one returns to the pool. A curse shows its **range** and **clearance condition**. Each team has a private hand with an inventory limit.
- **Curses and siphoning:** an active curse transfers time from the victim to the attacker, and the victim also suffers an extra drain. **Curses travel with the team holding them**: a cursed team stays cursed wherever it goes until it completes the clearance condition. Power-ups may change rates, for example by doubling them.
- **Range:** a card can only be used when the attacker is within the card's range of the target.

### Working defaults (not in the spec; confirm or change)
| # | Default | Notes |
|---|---|---|
| D1 | The game starts in Preparation. One admin action switches **every team** to Elimination at the same server moment. Schedule: Preparation 8–12, lunch 12–1, Elimination 1–5. | The admin presses the button at 1:00. Scheduling the start in advance was dropped. |
| D2 | Pause, used for lunch or emergencies, freezes every countdown and curse effect, and blocks team actions. No time is charged for paused time. | |
| D3 | A team at zero during Elimination is marked eliminated once and can no longer act. It can still view the board. | |
| D4 | The board shows **10** active challenges, adjustable by the admin from 1 to 50. Replacements are picked **at random** from the unused pool. | Confirmed. |
| D5 | Teams self-report claims with no admin approval, and the first claim wins. Teams can claim several in a row, **only during Preparation**, and not while the game is paused or after they've been eliminated. The board is hidden from teams in Elimination. The time bonus is added immediately, and a card draw is queued. | Preparation-only from 2026-11-03 (migration 0016). |
| D6 | A challenge reward is "draw N pick K" (K defaults to 1): the team taps Draw, sees N random cards, and keeps K. The rest go back into the deck. If the deck has fewer than N cards, the team sees what's left. When only one card is revealed, it goes straight into the hand with no choice step. | Confirmed. Each claim queues a draw; a draw stays open across refreshes. |
| D7 | Card types for now are **curse** and **power-up** (the card list is still being planned). Time cards aren't included, because challenges give time bonuses directly. | New types or effects can be added later with a small database change. |
| D8 | **Hand limit: 5 cards by default**; the admin can set 1–50 (Admin → Cards). Offered cards don't count. A team over the limit can't draw or use cards until it discards down to the limit; claims still work. | Added 2026-10-23 (migration 0012). |
| D9 | Each active curse adds **+1×** to the victim's speed and **−1×** to the attacker's (from 1×: victim 2×, attacker 0×). Curses stack, so a team can curse and be cursed at once. A team cursing two teams runs at −1×, so its clock goes up. | Changed from fixed speeds on 2026-10-23 (migration 0011). |
| D10 | A team can have several curses on it and play several, but **only one per pair**: team A can have at most one active curse on team B (B can still curse A at the same time). | Changed from one curse per target on 2026-11-03 (migration 0017). |
| D11 | Curses can only be **played** during Elimination (blocked in Preparation, checked by the server). Steals work in either phase. No curse effects apply while paused. When a team is eliminated, every curse it played or suffers ends automatically and the other team's speed shifts back. | Play-blocking added 2026-10-23 (migration 0011). Steals in Preparation and curses ending at elimination from 2026-11-03 (migration 0016). |
| D12 | Range is honor-system in Tier 1: the attacker ticks "Range condition met: <the card's range text>" when playing the card. A range need not be "near the target" (e.g. near a place, or the team furthest from you). Steals have no range (migration 0022). | Automatic checking is Tier 2. |
| D14 | A cursed team can end a curse early, any time (even while paused), in two ways: a **Veto card** (free), or **paying 30 minutes**, which go to the team that played the curse. Paying is refused below 30 minutes left; exactly 30 is allowed and takes the team to 0 (eliminated). Vetoes only work on curses, not on power-ups such as steals. | Added 2026-11-04 (migration 0021). |
| D13 | Teams change their countdown speed by hand with **▼ / ▲ arrows**, 1× per tap, anywhere from −20× to 20×. 1× is normal, 0× stops the clock, 2× drains double, below 0 the clock goes up. Curses shift speeds by 1 (D9). Speed only has an effect during Elimination when the game isn't paused. Manual changes are for fixing mistakes. | Every change is logged. A team's speed is private to it and the admin (migration 0022). Arrows replaced the 0×/1×/2× buttons on 2026-11-03 (migration 0017). |

## 4. Requirements by tier

### Tier 1: required for the game (target Nov 1)

**1. Team time pools and countdowns**
- Track each team's accumulated time during Preparation.
- All countdowns start together when Elimination begins (D1). Pause and resume apply to all teams (D2).
- Identify a team that reaches zero (D3).
- **Countdown speed (D13):** each team's countdown runs at **0×, 1× or 2×**.
  - When a curse is played, the victim's speed goes up by **1×** and the attacker's down by **1×** automatically (D9).
  - When the victim marks the clearance task done, both shift back automatically.
  - Teams can also change their own speed by hand, to fix mistakes.
  - Every speed change goes in the balance history.
  - A team's current speed is visible only to that team and on the admin page.
  - The admin can reset a team's speed and correct its balance.
- **Balance history:** every change is recorded (team, amount, reason, who, when). The admin can add or subtract time, or reverse an entry, to correct mistakes.
- State survives refresh and closing the page, because the server owns the time.

**2. Shared challenge board**
- Display the current challenges and their rewards (card draws and a time bonus).
- Teams claim challenges themselves (D5). Each claim is recorded against the team, and the challenge is replaced automatically.
- Prevent duplicate rewards: when two teams claim at the same moment, only one wins.
- Organisers can easily load and update challenge content (section 6, Content).

**3. Shared card deck**
- Draw from a common pool of individual copies (time, curse, power-up). No copy can be held by two teams.
- Display card instructions, including a curse's range and clearance condition.
- Record every draw and which team holds each copy.
- Hands are private. The spec accepts honor-system team selection, but we already have team logins (Stage 1), so privacy is enforced.

**4. Team card hand**
- Inventory limit (D8).
- **Teams act for themselves:**
  - **Use** a card: it leaves the hand and the use is logged.
  - **Discard** a card: it goes back to the pool.
  - **Steal:** the attacker plays a steal card, and the server moves one random card from the target's hand to the attacker's hand.
- Power-up effects the system doesn't automate yet are shown as instructions, and are applied by the admin's time correction only if needed.

### Tier 2: next priorities (only after Tier 1 passes a playtest)
- **Automatic siphoning:** 
  - Playing a curse sets both teams' speeds automatically (D9).
  - Clearing it resets both speeds to 1×.
  - A victim can be eliminated while still cursed.
  - Power-ups that change rates (e.g. doubling) are included.
- **Range checking:** when a card is used, compare the attacker–target distance against the card's range, using the teams' shared locations. Continuous tracking is optional. ⚠ *This is the hardest feature and unlikely to be ready early; the fallback is D12.*
- **Automatic hand-limit handling and any remaining power-up effects.**

### Tier 3: useful additions
- Team logins and accounts. ✅ *Done early in Stage 1.*
- Clear notifications for attacks, clearance, rewards and elimination.
- A map showing teams and attack ranges. It depends on shared locations from Tier 2.
- A more polished mobile interface.

## 5. Dependencies and risks

- **Time (Stage 2) comes first.** Curses, steals and time cards all write to the balance history.
- **Cards depend on challenges** (rewards trigger draws) **and on time** (time cards add to the balance).
- **Team self-service adds work to Tier 1.** Teams playing curses and steals themselves (Stages 4–5) is more work than admin-only buttons. If Stage 5 runs late, the fallback is admin-only buttons that do the same database actions.
- **The team speed toggle (Tier 1) relies on honesty and memory.** A team might:
  - forget to change speed when a curse starts or is cleared
  - leave itself at 0× to stop its own clock.

  Mitigations:
  - every change is logged
  - the admin can reset a speed and correct a balance.

  Automatic siphoning (Tier 2) removes this risk.
- **Range checking and the map** need shared team locations, which don't exist yet. ⚠ They are unlikely to be ready early.
- **Content:** the real challenge list and card deck must be written in the content format by about **Nov 4** for the rehearsal. This isn't a coding task, but it blocks realistic testing.
- **People:** several phones and players are needed for the simultaneous-claim tests, the playtest and the rehearsal.
- **Free tiers:** Supabase pauses free projects after about a week of inactivity, so open the site the day before the game.

## 6. Technical design

**Stack:**
- Next.js 16 (App Router, TypeScript, Tailwind) lives in `web/`.
- Supabase provides Postgres, Auth and Realtime.
- Vercel hosts the site and deploys automatically on `git push` (Root Directory = `web`).
- The repo is private: `github.com/NYAspen/time-crunch`.

**Next 16 specifics:**
- Middleware is `proxy.ts`.
- Cache Components is on, so request-time reads such as cookies must be inside `<Suspense>`.
- Code that reads the clock or random values must come after `await connection()`.
- Read `web/node_modules/next/dist/docs/` before using unfamiliar Next APIs.

**Security model:**
- Browsers only **read**, and Row Level Security (RLS) limits what each user sees.
- Every write goes through one of two paths:
  - A security-definer Postgres function (RPC). These functions check who is calling: for team actions, that the caller is that team, owns the card, the team is active, and the game is not paused. **The browser calls these directly** (`app/team/gameActions.ts`, `app/admin/adminActions.ts`). Don't route them through Next.js server actions: on Vercel, server actions run one at a time per phone and can hit slow cold starts, which made the game feel laggy.
  - A server action (`app/admin/actions.ts`, plus the login actions) that re-checks admin rights and then uses the secret key (`lib/supabase/admin.ts`, server-only). Only managing team logins needs this.
- Never trust the browser for remaining time, card ownership, challenge availability or elimination.

**Atomic actions:** claims, draws and steals each run inside one Postgres function with row locks, so simultaneous requests can't both succeed.

**Timer design (Stage 2):**
- Store each team's balance with the server timestamp it was last settled at (the "anchor").
- Each team's clock row (`team_clocks`) holds a snapshot: `balance_ms`, `anchor_at`, `speed` (0/1/2) and `running` (Elimination, not paused, team active).
- Remaining time = `running` ? balance − speed × (now − anchor) : balance. The screen only uses the clock row, never `teams.speed` or `game_state`. Mixing them caused visible jumps (fixed in migration 0004).
- **Change state first, then settle.** Every action (speed change, status change, pause, resume, phase change) updates `teams` or `game_state`, then calls `_settle_team` / `_settle_all`.
- Settling charges the time elapsed since the last settle at the **stored** speed and running values, then copies the current state onto the clock row with a new anchor.
- Time adjustments settle, then add the delta and write a history row.
- The browser only displays the remaining time, corrected for the phone's clock offset.

**Team identification:**
- Each team is a Supabase Auth user (`team-<teamId>@example.com`) whose password is the team's lowercased code.
- The admin is a Supabase user listed in the `admins` table.
- Passwords can't be read back, so a copy of each code is kept in `team_codes` (admin only), saved by `app/admin/actions.ts` when a team is created or its code is set.

**Live UI:** `components/useLiveTable.ts` reloads data when the database broadcasts that a table changed, when the tab becomes visible again, when the phone reconnects, and every 20 s as a safety net.
- **Sync broadcast** (migration 0010):
  - Statement-level triggers on every game table call `realtime.send({table}, 'changed', 'game-sync', false)`. The message contains only the table name, no data.
  - Each browser tab keeps ONE channel to `game-sync`, and only the sections showing that table reload. RLS decides what each one gets back.
  - **Don't** go back to `postgres_changes` subscriptions per component. Supabase checks RLS for every change × every subscription, one at a time, and with about 30 subscriptions per page that made updates arrive seconds late.
  - `scripts/sync-check.mjs` measures the delay.
- **Rule:** on the **team page**, show every action's result with `showResult(result)` from `components/Toasts.tsx` (a pop-down at the top; green fades after 5 s, others after 8 s; × to close). Pass `{ undoable: true }` for actions that create a team undo (claim, use, discard, clear, veto): their message then shows only in the bottom Undo bar ("✓ Done … Undo"), never twice. On the **admin page**, use `components/Notice.tsx` inline. Don't write one-off message boxes.
- **Rule:** after any action, call `refreshAllLiveTables()`, or wrap form actions in `withRefresh(...)`. Every section then updates immediately; Supabase's realtime messages can take a few seconds and are only a backup.

**Migrations:**
- These are numbered SQL files in `web/supabase/migrations/`.
- Run them in order, by hand, in the Supabase SQL Editor.
- Never edit a migration after it has been run.

**Content:**
- Challenges and cards are CSV files in `content/`, editable in Google Sheets or Excel.
- They are loaded through an admin Import screen.
- **Challenges** (`content/challenges-example.csv`) have the columns `title, task, location, reward_cards, reward_keep, reward_minutes`. `location` (blank = anywhere) and `reward_keep` (default 1) are optional. Copy the rows from Google Sheets, headers included, into Admin → Challenges → Import. Imported challenges go into the hidden pool, and the board fills from it at random.
- **Cards** (`content/cards-example.csv`) have the columns `name, type, copies, description, range, clearance, effect`. `type` is `curse` or `powerup`; `effect` is blank (manual), `duplicate`, `steal`, `veto`, `draw X pick Y`, `hand +N`, `reward xN`, `curse xN`, `curse copy`, `discard X draw Y`, `replace challenge` or `lock challenge`. Import them in Admin → Cards → Import cards.

**Fresh test game:** the admin-only "Reset game" (type RESET to confirm) works like this:
- It clears time, time history, claims, hands, draws, curses and the activity log.
- It returns every challenge to the pool and every card to the deck.
- It unpauses the game and sets the phase back to Preparation, with 0 time for everyone.
- Challenge and card content is kept. A tick box also deletes all teams and their logins.
- "Delete all challenges" and "Delete all cards" buttons in their own admin sections clear the content itself.

**Env vars** (`web/.env.local`, plus the same values in Vercel):
- `NEXT_PUBLIC_SUPABASE_URL`: the project URL only, with no `/rest/v1/`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`: this one is secret.

## 7. Build stages (Tier 1)

**Stage 1: Setup and team identification ✅**
- Supabase is connected, with admin and team logins.
- The admin creates and manages teams.
- A live shared phase and pause, and an activity log.
- An RLS check script.
- Deployed to Vercel.
- Reduced to two phases (migration 0002).

**Stage 2: Time pools and countdowns ✅**
- A private team balance and a balance history.
- Admin corrections: add or subtract time with a reason, or reverse a history entry.
- The Elimination start applies to all teams at once from the admin's button (D1). Pause and resume settle all teams (D2).
- A live countdown on the team and admin pages, with zero detection that marks a team eliminated only once (D3).
- A team speed toggle (0×, 1×, 2×): every change is logged, the current speed is visible to all, and the admin can reset it (D13).
- **Test:** refresh, lock the phone for 5 minutes, pause and resume, and check that two phones show the same time.

**Stage 3: Shared challenge board ✅**
- Challenges with a title, task, rewards (cards and minutes) and a status (pool, active, claimed or retired).
- CSV import and admin editing.
- A configurable number of active challenges (D4).
- Atomic team claims with automatic replacement (D5).
- **Test:** two phones claim the same challenge at the same moment.

**Stage 4: Shared card deck and team hands ✅**
- Card types and individual copies, loaded by CSV import.
- Draw N, keep 1 (D6).
- Private hands with a hand limit (D8).
- Time cards credit the balance (D7).
- Teams use and discard their own cards.
- **Test:** simultaneous draws never give out the same copy twice.

**Stage 5: Curses, reset and the full loop ✅** (full-loop phone test still to do)
- Teams play curse cards on a target, with a range confirmation (D12). Only one active curse is allowed per target (D10).
- **Speeds change automatically** (migration 0009):
  - Playing a curse sets the target to 2× and the attacker to 0×.
  - Clearing it, by the victim or the admin, sets the target to 1×. The attacker also goes to 1×, unless it still has another active curse.
  - Teams can still change speeds by hand to fix mistakes. The banner offers a one-tap fix if a speed doesn't match the curse.
- The admin sees active curses, with each team's current speed, and can clear a curse.
- Reset game, plus delete-all for challenges and for cards.
- Setup instructions are in `README.md` (2026-10-23).
- Stealing by teams was deferred. The admin can still move cards.
- **Test:** the full loop with several teams on phones.

## 8. Open questions

- **Card list (still being planned):**
  - What is the real deck, and which power-ups need automatic effects?
  - Are there veto or steal cards?
  - What should the hand limit be? (Default 5, adjustable.)

## 9. Progress tracker

**Current stage:** Tier 1 is complete (Stages 1–5), and the first round of UI adjustments was done on 2026-10-23. The README was written on 2026-10-23. Next is the full-loop test on several phones. It is the last Tier 1 stage.

### Implemented
- **Stage 1:**
  - Database: `game_state`, `teams`, `admins` and `activity_log`, with RLS, the `admin_set_phase` / `admin_set_paused` RPCs, and Realtime.
  - Landing page, team login (pick a team and enter a code), and team page (live phase banner and team list).
  - Admin dashboard:
    - phase switch with confirmation
    - pause/resume
    - create, rename, reset the code of, and delete teams
    - live activity log
  - `web/scripts/rls-check.mjs`.
  - Deployed on Vercel and tested on phones on 2026-10-22.
  - Two phases only, Preparation and Elimination (migration 0002, run and tested).
- **Stage 2** (migrations `0003_time.sql` and `0004_clock_snapshot.sql`, both run and tested):
  - Database:
    - `team_clocks` (private: own team or admin), with `balance_ms` and `anchor_at`
    - `teams.speed` (public) and `teams.eliminated_at`
    - `time_ledger` (balance history)
  - Database functions:
    - All time maths runs in the database (`_settle_team`).
    - Phase change and pause/resume settle every clock first.
    - `_sweep_eliminations` eliminates each team exactly once and records the exact time it hit zero. It runs after every time-changing action, and browsers trigger it when a countdown on screen reaches 0.
  - Team page:
    - live countdown, corrected to the server's clock
    - 0×/1×/2× speed buttons
    - the team's own time history
  - Admin page:
    - per-team live clocks; any team not at 1× is highlighted
    - add or subtract time with a reason
    - set a team's speed
    - eliminate a team or bring it back
    - time history with Undo
  - Public team list shows each team's speed when it isn't 1×.
  - `rls-check.mjs` has 9 new time checks.

- **Stage 3** (migration `0005_challenges.sql`; run and tested):
  - The `challenges` table (pool → active → claimed, plus retired) and `game_state.board_size` (default 10).
  - The `claim_challenge` function:
    - row lock, so the first claim wins
    - adds the time bonus to the history
    - refills the board at random (advisory lock, so it can't overfill).
  - Team page: board with a Claim button and confirmation, plus a list of claimed challenges.
  - Admin page:
    - board size
    - paste-from-Sheets import
    - edit, remove or restore challenges
    - pool and claimed lists.
  - `scripts/race-claim.mjs` tests simultaneous claims and double-taps. `rls-check.mjs` has 4 new challenge checks.
- **Admin page tidy-up:**
  - Every section is collapsible (`components/CollapsibleSection.tsx`), with a status summary.
  - Only Game controls and Team time start open.
  - The time history and activity log show 15 entries at a time, with Show more.

- **Stage 4** (migrations `0006_cards.sql` and `0007_single_card_draw.sql`; run and tested):
  - Database:
    - `card_types` (text, range, clearance and an optional automatic `effect`)
    - `cards` (one row per physical copy: deck, offered, hand or removed)
    - `card_draws` (pending, open or done)
  - Claims now queue a draw, and claims made before cards existed were given their draws.
  - Database functions for teams:
    - `open_draw` uses `skip locked`, so no copy is shown to two teams
    - `choose_card` (the rest go back to the deck)
    - `use_card`: manual effect; the card returns to the deck. The **duplicate** effect is automatic and creates a temporary copy that disappears when used or discarded.
    - `discard_card`
  - Team page: a "Your cards" section with waiting draws, keep-one-of-N, and the hand with Use/Discard.
  - Admin "Cards" section:
    - import from Sheets
    - card types with ±1 copies and edit
    - cards held by each team, with Move (to another team or back to the deck), used for stealing
    - give a team a draw
  - Every live section also reloads every 20 s as a safety net, because realtime doesn't report rows disappearing from a team's view.
  - `scripts/race-draw.mjs` tests simultaneous draws. `rls-check.mjs` has 7 new card checks.
  - Sample deck: `content/cards-example.csv`.

- **Stage 5** (migrations `0008_curses_reset.sql` and `0009_auto_curse_speed.sql`; run and tested):
  - `curses` table: a snapshot of the card's name, range and clearance; one active curse per target.
  - `use_card(p_card, p_target, p_target_team, p_in_range)`: a curse needs a target team and a range confirmation.
  - Clearing a curse: `clear_curse` (victim only) and `admin_clear_curse`.
  - Team page: `CurseBanner`, showing the curse on the team or by the team, the clearance task, and one-tap speed buttons.
  - Admin page:
    - "Curses" section listing active curses with each team's speed, and a Clear button
    - "Reset game" section
    - Delete all challenges and Delete all cards
  - Bulk SQL statements use `where true`, because Supabase blocks UPDATE/DELETE without a WHERE clause.
  - `rls-check.mjs` now has 34 checks.

- **Stacking curse speeds** (migration `0011_curse_speed_steps.sql`, 2026-10-23; run):
  - Curses shift speeds by ±1 (`_shift_speed`) instead of setting them, so a team can curse and be cursed at once.
  - `teams.speed` is now allowed from −20 to 20.
  - `use_card` rejects curses outside Elimination. On the Cards tab, **Use** is greyed out for curses in Preparation and for every card while paused, with a one-line note above the hand (like claims). Discard still works while paused.
  - `_curse_speed(team)` = 1 + curses on the team − curses it played. `sync_my_speed()` (team) and `admin_sync_speed(team)` set a team's speed to that value. The curse banner and the admin Curses section show a Fix button when a speed doesn't match.
  - `rls-check.mjs` has 1 new check (35).

- **Hand limit** (migration `0012_hand_limit.sql`, 2026-10-23; run):
  - `game_state.hand_limit` (default 5, 1–50), set with `admin_set_hand_limit`.
  - `_hand_excess(team)` / `_require_hand_within_limit(team)`: `open_draw` and `use_card` refuse while over the limit. `choose_card` and `discard_card` still work.
  - Team Cards tab: a "Cards in hand n / limit" meter at the top (one slot per card; grey, then orange when full, then red when over), a red over-limit box, and greyed-out Draw and Use buttons. The Cards tab button always shows n/limit, in red when over.
  - Admin Cards section: hand-limit setting, and n/limit per team under "Cards held by teams".
  - `rls-check.mjs` has 1 new check (36).

- **Undo** (migration `0013_undo.sql`, 2026-10-26; run):
  - Team undo window: for **60 s** after claiming, using a card, discarding or clearing a curse, a pinned **Undo** bar shows at the bottom of the team page (`app/team/UndoBar.tsx`, table `team_undos`, function `undo_action`).
    - A claim can't be undone once the team has drawn from it.
    - Undoing a use or discard fails if another team has drawn that card since.
    - Undoing a curse removes it and shifts speeds back. Undoing a clear restarts the curse.
  - Admin:
    - **Undo claim** (Challenges → Claimed) puts the challenge back on the board (the replacement returns to the pool), reverses the time bonus, and cancels the draw if not yet drawn.
    - **Cancel draw** (Cards → Waiting draws).
    - **Give a card from the deck** (Cards), using `admin_move_card`.
    - **Restart** a curse cleared in the last hour (Curses → Recently cleared).
  - `card_draws.challenge_id` links a draw to its claim.
  - `rls-check.mjs` has 4 new checks (40).

- **Undo from the activity log** (migration `0014_activity_undo.sql`, 2026-10-26; run):
  - The admin **Time history** section was removed. The **Activity log** is the one admin history: readable entries with team names, amounts and speeds, an **Undo** button (with confirm) on undoable entries, and undone entries struck through.
  - `admin_undo_activity(entry)` undoes: claims (challenge back, bonus reversed, draw cancelled), card uses and curses, discards, curse clears, admin time adjustments, speed changes (shifted back by the change, so later curses still count) and eliminations (team revived).
  - An entry is matched to what it changed by team + timestamp (one action's writes share `now()`). Card uses and discards from before 0013 can't be undone this way; use Move.
  - `activity_log.undone_at`. Team undos, Undo claim and curse Restart also mark the matching entry undone. Shared logic in `_apply_undo`.
  - The team page keeps its own "Show my time history" link.
  - `rls-check.mjs` has 1 new check (41).

- **UI adjustments (2026-10-23):**
  - Messages use `components/Notice.tsx`: they fade after 5 s (8 s for errors) and have an × to close.
  - Team page is mobile-first:
    - header: team name with a blue "Current phase" tag, plus a paused badge
    - countdown at the top, then a compact "Countdown speed" box
    - curse banner
    - sticky tabs: **Challenges | Cards | Teams**. The Cards tab shows a count of waiting draws, and the team's time history is a small link at the bottom of the Teams tab.
  - Admin page:
    - Reset game section is red (`CollapsibleSection danger`)
    - Time history was its own section above the Activity log (removed 2026-10-26; undo is in the Activity log)
    - home and admin pages keep the full phase banner

- **Power-ups** (migration `0015_powerups.sql`, 2026-11-02; run):
  - `draw X pick Y`: a new draw that keeps Y of X (`card_draws.keep` / `kept`). `choose_card` keeps the draw open until Y are kept. A draw showing no more than Y cards goes straight into the hand. Challenge draws stay keep 1.
  - `hand +N`: `teams.hand_bonus` (public) is added to the game's limit (`_hand_limit(team)`) for the rest of the game. Reset sets it back to 0.
  - `steal`: Elimination only, with a range confirmation (like curses). Moves a random card from the target's hand and records a `steals` row (attacker, target or admin can read it).
  - `veto`: not playable from the hand. `veto_curse` (Veto button on the curse banner, any time while cursed; `cleared_by = 'veto'`, speeds shift back) and `veto_steal` (`app/team/StealAlert.tsx`, within 60 s, only while the card is still in the thief's hand).
  - Team Undo (60 s) and admin activity-log Undo cover steals, draws, hand bonuses and vetoes. A vetoed curse or steal can't be undone by the attacker.
  - `rls-check.mjs` has 4 new checks.

- **Design: L Platform (CTA station signage), 2026-11-02, branch `feature/ui`:**
  - Chosen over Departures, Four Stars, Timetable and three Platform variations (all removed, with the design picker). Square corners, Helvetica (Arimo where Helvetica is missing), black sign bars, the 'L' line colours.
  - `app/themes.css` holds the design, switched on by `<html data-theme="platform">` in `app/layout.tsx`. It remaps Tailwind's colour, corner and font variables, plus a few `tc-*` hook classes (countdown, tabs, sections, challenge boxes).
  - Sign-style pieces: challenge rewards and team status are square tags (icon block + label); `Notice` is a service-alert box (green ✓ "Done" / red ! "Problem"); the Undo bar and steal alert match.
  - Cards (`CardView`) have a coloured name bar (red curse, blue power-up), Range / To clear rows, a thick edge and a drop shadow. Draw boxes have a purple header bar. Hand and draw-pick cards are smaller (`compact`), two to a row (draw picks on a grey tray); a hand card spans the full width while being used or discarded. Curse cards show their clearance task as the main text ("To clear") and leave off the description.
  - Speed buttons (`components/speedStyles.ts`, team and admin): 0× blue, 1× black, 2× orange.
  - Typography: heavy, tight headlines; small bold uppercase labels (`tc-label`, phase tag, tabs). Red sign-style Log out (`components/LogoutButton.tsx`). The home page is a station-name sign with no phase block.
  - **Consistency rules:** anything needing attention (curses, steals, confirmations, warnings, admin notes, draws) uses `components/SignBox.tsx` (coloured heading bar + white panel; red / orange / purple / yellow / green / black). The home and login pages start with `components/PageSign.tsx` (black station-name sign with a Purple Line bar). No pale tinted or rounded boxes.
  - Mobile defaults in `app/globals.css`: text boxes and dropdowns always 16px (stops iPhone zoom), buttons and dropdowns at least 36px tall, roomier fold-out headings, 20px checkboxes. Checked at 360px and 390px wide: no sideways scrolling on any page.

- **Rule and UI changes** (migration `0016_rules_nov3.sql`, 2026-11-03; run):
  - Challenges have a `location` (shown as "Location: …", blank = "Anywhere") and `reward_keep` ("draw 4 pick 2"). Import and admin edit include both.
  - Challenges can only be completed in Preparation (`claim_challenge` checks it); the team Challenges tab disappears in Elimination.
  - Steals can be played in either phase; curses stay Elimination only.
  - `_end_curses_for(team)`: when a team is eliminated (time ran out or by the admin), its curses end (`cleared_by = 'eliminated'`, activity `curse_ended`) and both speeds shift back. Bringing the team back doesn't restart them. The migration also ends any such curses already active.
  - Range confirmation reads "Range condition met: <range text>".
  - Curse boxes on the team page are compact: "Cursed: <card> by <team>" (with To clear, Task done and Veto) and "Your curse: <card> on <team>". The speed line only shows when a speed doesn't match the curses.
  - Undo bars closed with × stay closed after a reload (remembered in the phone's browser storage).
  - An eliminated team keeps its cards, but its Cards tab shows an "eliminated" sign and no Draw/Keep/Use/Discard (the database already refuses them via `_acting_team`). The admin can still Move its cards.
  - A steal on a team with no cards shows a small "Steal failed" note on the steal card; the card stays in the hand.
  - The team page shows the same big yellow "Game paused" box as the admin page (`PausedBox` in `components/PhaseBanner.tsx`) instead of a small badge.

- **Curse pairs and speed arrows** (migration `0017_curse_pairs_speed_arrows.sql`, 2026-11-03; run):
  - The unique index is now one active curse per (attacker, target) pair. `use_card` and `_restart_curse` check the pair.
  - The curse banner lists every curse on the team, each with its own Task done / Veto. The team picker on a curse card greys out teams you already curse.
  - `step_my_speed(±1)` and `admin_step_speed(team, ±1)` replace the 0×/1×/2× buttons (`components/SpeedStepper.tsx`, −20× to 20×). The team's arrows sit inside the countdown box. `set_my_speed` / `admin_set_speed` still exist but the app no longer calls them.
  - `rls-check.mjs` has 1 new check.
- **Speed arrows and curse signs, round 2** (migration `0018_speed_step_batch.sql`, 2026-11-03; run):
  - The team's ▲ / speed / ▼ column sits right of the countdown digits (`Countdown` `side` slot; the digits shrink on narrow phones).
  - `SpeedStepper` shows each tap at once, then sends the taps together after a 0.45 s pause as one change (`step_my_speed` / `admin_step_speed` now take any delta), so fast tapping doesn't lag and the log gets one line.
  - Curse signs: each curse on the team is a red sign ("Cursed by …", card name, +1× tag, To clear, since time, Task done / Veto). Curses the team played are one orange "Your curses (n)" sign with a row per curse (target, what they must do, since time).

- **Six more power-ups** (migration `0019_more_powerups.sql`, 2026-11-03; run):
  - `reward xN` (Preparation): the team's next completed challenge gives N× the time bonus and N separate draws (`teams.reward_multiplier`, used up by `claim_challenge`; `challenges.claim_multiplier` so Undo claim gives it back). A green "Your next challenge is worth ×N" sign shows on the board.
  - `curse xN` (Elimination): played on one of the team's active curses; the attacker gains N× (`curses.attacker_gain`, speed shifts by −gain). The victim stays +1×. Every place that starts, ends, restarts or undoes a curse uses `attacker_gain`, and so does `_curse_speed` / `curseSpeed`.
  - **The ×N power-ups don't stack**: one reward bonus waiting at a time, and a curse can only be boosted once (server refuses; the phone greys them out).
  - `curse copy` (Elimination, range confirm): one of the team's active curses goes on a second team too, as its own curse (one per pair still applies). Logged as `curse_started`.
  - `discard X draw Y`: tick X other cards to discard; a "draw Y keep Y" draw is queued.
  - `replace challenge` (Preparation): the chosen board challenge goes back to the pool and a random one replaces it (it can't come straight back). A challenge another team has locked can't be replaced.
  - `lock challenge` (Preparation): only the locking team can complete it; one lock per team (`challenges.locked_by`, unique index). A trigger clears the lock whenever the challenge leaves the board (claimed, removed, replaced, reset).
  - `use_card` gained `p_curse`, `p_challenge`, `p_cards`. Team Undo (60 s) and admin activity-log Undo cover all six.
  - Sample cards for each in `content/cards-example.csv`.

- **Pop-down notifications** (migration `0020_team_feed.sql`, 2026-11-03; run and tested on localhost):
  - `team_feed()` gives each team only the activity-log entries meant for it (last 30 min): Elimination starting, any team eliminated / back in, other teams completing, replacing or locking a challenge, being cursed or stolen from, its curse cleared or vetoed, its steal vetoed, and admin corrections to it. The team's own actions are left out.
  - `app/team/EventFeed.tsx` turns new entries into pop-downs at the top (`components/Toasts.tsx`, at most 3 at once; a short buzz on Android for bad news). The newest entry shown is remembered on the phone, so reloads don't repeat them and things that happened while the phone was locked still show.
  - Action results on the team page are pop-downs too (no more inline green boxes). Undoable actions show one combined "✓ Done: <message> · Undo" bar at the bottom instead of a green box plus an Undo bar.
  - The "Card stolen" box only shows when the team holds a Veto (to offer it); otherwise the pop-down says what was stolen.
  - `rls-check.mjs` has 1 new check.

- **Paid veto; vetoes are curses only** (migration `0021_veto_for_time.sql`, 2026-11-04; **not yet run**):
  - `veto_curse_for_time`: the victim pays 30 minutes and the attacker gains them (`kind = 'curse_veto'` in the time history). "Pay 30 min to veto" on each curse sign, greyed out with a note below 30 minutes. The database checks the exact time left.
  - `curses.veto_paid_ms` records the payment. `_restart_curse` gives the time back, so team Undo (60 s), admin activity-log Undo and admin Restart all refund both teams. It refuses if the attacker has less than that time left, so an undo can't knock them out. The attacker gets a pop-down (`curse_veto_undone`).
  - Veto cards no longer work on steals: `veto_steal` and `app/team/StealAlert.tsx` were removed. The `steals` table keeps `veto_until` / `vetoed_at`, unused except to undo old entries.
  - `rls-check.mjs`: the veto-steal check became a paid-veto check.

- **Private speeds, visible team codes, no range on steals** (migration `0022_private_speed_codes_steal.sql`, 2026-11-04; **not yet run**):
  - Browsers can no longer read `teams.speed`: `teams` is granted column by column, so **a new column on `teams` must be added to that grant** before browsers can read it. Screens use `team_clocks.speed` (own team or admin) instead, and `PublicTeam` has no speed.
  - `team_codes` (admin read only, written with the secret key): Team logins shows each team's code. Teams created earlier show "not saved" until Set code is used.
  - `use_card` doesn't ask for a range confirmation on steals, the steal card has no range checkbox, and `CardView` never shows a range on one. Curses and curse copies still confirm range.
  - `rls-check.mjs` has 4 new checks.

### Outstanding
- Run migrations 0021 and 0022 in Supabase, then deploy this code right away: until the new code is live, the old site errors on `teams.speed`.
- Full-loop test on several phones.
- Stages 2–5 (Tier 1) by Nov 1. Then the playtest, Tier 2 if there is time, and the rehearsal (section 2).
- Write the real challenge list and card deck in the content format by about Nov 4.

### Known bugs
- Fixed 2026-10-23 (migration 0010): even after the direct-call change, sync was still slow and the admin's clocks lagged behind the phones.
  - Cause: each section subscribed to `postgres_changes` separately (about 30 subscriptions on the admin page, about 20 per team page). Supabase authorises every change against every subscription, one at a time.
  - Fix: one broadcast channel per tab, carrying table-changed signals.
- Fixed 2026-10-23: on Vercel, updates felt slow (countdowns lagging), and the admin's board count flickered.
  - Cause: every button went phone → Vercel server action → Supabase. Next.js runs server actions one at a time per phone, Vercel adds cold starts, and an action that refreshed the login cookie re-rendered the page.
  - Fix: game actions now call the database functions straight from the browser. Realtime itself was measured at about 0.4–0.5 s from Supabase to a logged-in team.
- Fixed 2026-10-22 (migration 0007): a "draw 1" looked like it didn't draw anything, because the team still had to tap "Keep" on the only card. A single revealed card now goes straight into the hand.
- Fixed 2026-10-22: banked time took several seconds to update after a challenge claim. It only updated when the realtime message arrived. All actions now trigger an immediate reload of every live section.
- Fixed 2026-10-22: after a team was brought back, its speed buttons appeared not to work.
  - The server recorded every tap correctly; the screen didn't update.
  - Fix:
    - `useLiveTable` ignores out-of-date replies when reloads overlap.
    - Team and admin actions reload their data straight away instead of waiting for realtime.
  - Retested and working.
- Fixed 2026-10-22: a team reaching 0 was not eliminated.
  - The browser's `sweep_eliminations` call was never sent, because Supabase requests only run when awaited.
  - It also never retried when the phone's clock was slightly ahead of the server's.
  - Fix: the check is awaited and repeats every 2 s while a countdown shows 0.
  - Remaining limitation: elimination is only detected while some team or admin page is open, or when another time action runs. The recorded elimination time is always the exact moment the time hit zero.
- Fixed 2026-10-22 (migration 0004): the countdown jumped when switching speed, pausing or resuming. The screen was combining a new speed with an old clock anchor.

### Decisions log
- 2026-10-22: Team login is a team pick plus a case-insensitive code of 6+ characters. It was kept even though the spec lists accounts as Tier 3, because it already works and keeps hands private.
- 2026-10-22: Switched to the Tier 1/2/3 spec. Dropped from the original brief:
  - photo upload for theft
  - dropped-card loot at elimination
  - recording lunch locations in the app

  Rules from the original brief that the new spec doesn't mention are kept only as working defaults.
- 2026-10-22: **Only two phases, Preparation and Elimination.** Lunch is a pause. The Setup, Lunch and Ended phases were removed (migration 0002).
- 2026-10-22: **Reduce admin reliance.**
  - Teams claim, draw, use, discard and steal cards, and start and clear curses, themselves. The admin only does setup, the Elimination start, pause, and corrections.
- 2026-10-22: Dropped scheduling the Elimination start in advance (planned as Stage 2b). The admin presses the button at 1:00.
- 2026-10-22: **Curse effects are handled manually by team-controlled countdown speed: 0×, 1× or 2× (D13).**
  - Curse length varies, because it depends on how long the victim takes to clear it.
  - While cursed, the victim runs at 2× and the attacker at 0×. The original brief had 3×; confirmed as 2×.
  - Automatic siphoning stays in Tier 2.
- 2026-10-22: Stage 2 rules:
  - Teams start with 0 banked time.
  - A team with 0 time when Elimination starts is eliminated immediately.
  - Teams can change speed at any time (honor system).
  - A team's balance is private: only the team itself and the admin can see it. Speed is public.
  - A balance never goes below 0.
- 2026-10-22: Challenges:
  - They have no location. Rewards are cards plus a time bonus.
  - The board holds 10 (admin-adjustable), with replacements drawn at random from the unused pool.
  - Teams can claim several in a row, in either phase, but not while the game is paused.
  - Undoing a claim's time bonus uses Undo in the time history. There is no separate "unclaim". (Superseded 2026-10-26: Undo claim, and Undo in the activity log.)
- 2026-10-22: Cards (Stage 4):
  - The card list isn't decided yet. Types for now are curse and power-up, with room to add more.
  - Effects are manual, except **duplicate** (copy another card in your hand).
  - Draw N, keep 1. No hand limit for now.
  - Used and discarded cards return to the deck. Duplicate copies disappear instead.
  - Stealing is done for now by the admin moving a card between teams.
- 2026-10-22: Stage 5:
  - Curse speeds use one-tap prompts, not automatic changes.
  - Team stealing is deferred; the admin can still move cards.
  - Reset keeps content and can optionally delete teams.
  - Delete-all buttons were added for challenges and for cards.
- To add another admin: create and confirm the user in Supabase Auth, then run `insert into public.admins (user_id) select id from auth.users where email = '...';`.
- 2026-10-23: **Curses now change speeds automatically**, replacing the one-tap prompts. Playing a curse sets the target to 2× and the attacker to 0×; clearing it sets both back to 1×. Manual speed changes remain for fixing mistakes.
  - This brings part of Tier 2's "automatic siphoning" forward. Power-ups that change rates are still manual.
  - Known edge case: if two teams curse each other at the exact same moment, the database may reject one with a "deadlock" error. That team just taps Use again.
- 2026-10-23: **Curses now add and subtract speed instead of setting it** (migration 0011), so teams can curse each other and be cursed at once. Each curse adds +1× to the victim and −1× to the attacker, and clearing it reverses that. Manual changes are kept: a curse shifts from whatever the speed currently is.
  - Default chosen: a team cursing several teams goes below 0×, so its clock counts up (it gains time from each victim). Alternative if that's unwanted: stop at 0×.
  - Still one active curse per target (D10).
- 2026-10-26: **Undo for teams and admin** (migration 0013).
  - Teams get 60 seconds to undo their own claim, card use, discard or curse clear.
  - The admin can undo claims, cancel draws, give a card back from the deck, and restart a cleared curse.
  - Undoing a curse doesn't refund the extra seconds the victim drained (at most 60 s); the admin can add time if needed.
- 2026-10-26: **Admin Time history removed; undo happens from the Activity log** (migration 0014). Undoing a challenge's time bonus there undoes the whole claim, including its draw.
- 2026-10-23: **Hand limit added** (D8). Default 5, admin-adjustable. Over the limit, the team must discard before drawing or using cards.
- 2026-11-02: **Power-ups** (migration 0015): Veto cancels a curse on you (any time while active) or takes back a stolen card within 60 s. Steal works like a curse: Elimination only, with a range confirmation. Hand +N lasts the rest of the game.
- 2026-11-02: **Wording:** teams tap **Completed** instead of Claim, and card rewards read "draw N pick 1" (or "draw 1 card"). This is a text change only; the database still calls it a claim, and server messages (errors, the Undo bar) still say "claim".
- 2026-11-02: **Discard only shows when a hand is over the limit** (team Cards tab). Otherwise cards can only be used. The database still allows discarding at any time, and the admin can still move cards back to the deck.
- 2026-11-03: **Challenges are Preparation only** (board hidden in Elimination); **steals allowed in Preparation**; **an eliminated team's curses end** (no time transfer after elimination; the few seconds between hitting zero and the server noticing are not refunded). Challenges get a location and "draw N pick K" rewards (migration 0016).
- 2026-11-03: **Several curses per team, one per pair of teams** (D10), and **speed arrows** (D13): teams step their own speed 1× at a time, −20× to 20×, instead of picking 0×/1×/2×. Default chosen: teams can step below 0× by hand too (logged and public). Alternative if abused: limit teams' own arrows to 0×–2× and leave the full range to the admin.
- 2026-11-03: **Six more power-ups** (migration 0019). Defaults confirmed: reward ×N applies to the *next* completion (time and draws); curse ×N is played on an active curse and only boosts the attacker's gain; curse copy is played on an active curse; a lock lasts until the team completes it, one lock per team. **×N power-ups don't stack.** Defaults chosen: discard X draw Y keeps all Y drawn; a replaced challenge goes back to the pool.
- 2026-11-04: **A team's speed is private** (replaces "Speed is public" from 2026-10-22), **the admin can see team codes** (stored readable, admin only), and **steals have no range** (migration 0022).
- 2026-11-04: **Paid veto, and vetoes are curses only** (D14, migration 0021). Replaces "Veto takes back a stolen card" from 2026-11-02. Defaults chosen: the Veto card stays free alongside the paid option, and a paid veto can be undone like a card veto.
- 2026-10-23: **Curses can't be played during Preparation**, only during Elimination (D11). Teams can still draw and hold them in the morning.
