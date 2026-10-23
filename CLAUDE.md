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
| Oct 23–25 | Stage 2: team time pools, countdowns, balance history |
| Oct 25–27 | Stage 3: shared challenge board |
| Oct 27–30 | Stage 4: shared card deck and team hands |
| Oct 30–Nov 1 | Stage 5: team-recorded curses and steals, reset game, full-loop test on phones |
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
- **Challenges:** there is a shared board. Each challenge has a reward and a place where it can be completed. A completed challenge is claimed, recorded against the claiming team, and replaced. Duplicate rewards must be prevented.
- **Cards:** there is one common pool of individual copies of **time cards, curses and power-ups**. If the deck has two copies of a curse, only those two can be drawn until one returns to the pool. A curse shows its **range** and **clearance condition**. Each team has a private hand with an inventory limit.
- **Curses and siphoning:** an active curse transfers time from the victim to the attacker, and the victim also suffers an extra drain. **Curses travel with the team holding them**: a cursed team stays cursed wherever it goes until it completes the clearance condition. Power-ups may change rates, for example by doubling them.
- **Range:** a card can only be used when the attacker is within the card's range of the target.

### Working defaults (not in the spec; confirm or change)
| # | Default | Notes |
|---|---|---|
| D1 | The game starts in Preparation. One admin action switches **every team** to Elimination at the same server moment. Schedule: Preparation 8–12, lunch 12–1, Elimination 1–5. | Planned for Stage 2: the admin can set the Elimination start time in advance, and the server switches automatically, so no button press is needed at 1:00. |
| D2 | Pause, used for lunch or emergencies, freezes every countdown and curse effect, and blocks team actions. No time is charged for paused time. | |
| D3 | A team at zero during Elimination is marked eliminated once and can no longer act. It can still view the board. | |
| D4 | The board shows a configurable number of active challenges, starting at 8. | |
| D5 | Teams self-report claims. No admin approval; the first claim wins. | |
| D6 | A challenge reward is "draw N": the team sees N cards, keeps 1, and the rest are reshuffled into the pool. | |
| D7 | A time card adds its minutes to the team's balance and doesn't count toward the hand limit. | |
| D8 | The hand limit is **7**. A draw that would go over the limit is blocked until the team uses or discards a card. | |
| D9 | While a curse is active during Elimination, the victim's countdown runs at **2×** and the attacker's at **0×**, so the attacker effectively gains 1 min per real minute. | 
| D10 | A team can have at most one active curse at a time. | |
| D11 | No curse effects apply during Preparation or while paused. | |
| D12 | Range is honor-system in Tier 1: the attacker confirms "we are within range" when playing the card. | Automatic checking is Tier 2. |
| D13 | Each team controls its own countdown speed: **0×, 1× or 2×**. 1× is normal, 0× stops the clock, and 2× drains double. Speed only has an effect during Elimination when the game isn't paused. | Honor system. Each change is logged, and every team's speed is shown publicly. |

## 4. Requirements by tier

### Tier 1: required for the game (target Nov 1)

**1. Team time pools and countdowns**
- Track each team's accumulated time during Preparation.
- All countdowns start together when Elimination begins (D1). Pause and resume apply to all teams (D2).
- Identify a team that reaches zero (D3).
- **Team-controlled countdown speed (honor system, D13):** each team switches its own countdown between **0×, 1× and 2×**.
  - When a curse is played, the victim switches to **2×** and the attacker to **0×** (D9).
  - When the victim completes the clearance challenge, both switch back to **1×**.
  - Every speed change goes in the balance history.
  - Each team's current speed is visible to everyone and on the admin page.
  - The admin can reset a team's speed and correct its balance.
- **Balance history:** every change is recorded (team, amount, reason, who, when). The admin can add or subtract time, or reverse an entry, to correct mistakes.
- State survives refresh and closing the page, because the server owns the time.

**2. Shared challenge board**
- Display the current challenges, their rewards and where each can be completed.
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
  - A security-definer Postgres function (RPC). These functions check who is calling: for team actions, that the caller is that team, owns the card, the team is active, and the game is not paused.
  - A server action (`app/**/actions.ts`) that re-checks admin rights and then uses the secret key (`lib/supabase/admin.ts`, server-only).
- Never trust the browser for remaining time, card ownership, challenge availability or elimination.

**Atomic actions:** claims, draws and steals each run inside one Postgres function with row locks, so simultaneous requests can't both succeed.

**Timer design (Stage 2):**
- Store each team's balance with the server timestamp it was last settled at (the "anchor").
- Each team also has a `speed` of 0, 1 or 2.
- While Elimination is running and unpaused: remaining = balance − speed × (now − anchor).
- Every change (speed change, adjustment, pause, resume or the Elimination start) first settles the balance up to now, then writes a new anchor and a history row.
- The browser only displays the remaining time, corrected for the phone's clock offset.

**Team identification:**
- Each team is a Supabase Auth user (`team-<teamId>@example.com`) whose password is the team's lowercased code.
- The admin is a Supabase user listed in the `admins` table.

**Live UI:** `components/useLiveTable.ts` reloads data on Realtime changes, when the tab becomes visible again, and when the phone reconnects.

**Migrations:**
- These are numbered SQL files in `web/supabase/migrations/`.
- Run them in order, by hand, in the Supabase SQL Editor.
- Never edit a migration after it has been run.

**Content:**
- Challenges and cards are CSV files in `content/`, editable in Google Sheets or Excel.
- They are loaded through an admin Import screen.
- The columns will be defined in Stages 3 and 4.

**Fresh test game:** an admin-only "Reset game" clears claims, hands, history and curses, reloads the content, unpauses, and sets the phase back to Preparation.

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

**Stage 2: Time pools and countdowns**
- A private team balance and a balance history.
- Admin corrections: add or subtract time with a reason, or reverse a history entry.
- The Elimination start applies to all teams at once, either from the admin's button or from a start time set in advance (D1). Pause and resume settle all teams (D2).
- A live countdown on the team and admin pages, with zero detection that marks a team eliminated only once (D3).
- A team speed toggle (0×, 1×, 2×): every change is logged, the current speed is visible to all, and the admin can reset it (D13).
- **Test:** refresh, lock the phone for 5 minutes, pause and resume, and check that two phones show the same time.

**Stage 3: Shared challenge board**
- Challenges with a title, task, location, reward and status.
- CSV import and admin editing.
- A configurable number of active challenges (D4).
- Atomic team claims with automatic replacement (D5).
- **Test:** two phones claim the same challenge at the same moment.

**Stage 4: Shared card deck and team hands**
- Card types and individual copies, loaded by CSV import.
- Draw N, keep 1 (D6).
- Private hands with a hand limit (D8).
- Time cards credit the balance (D7).
- Teams use and discard their own cards.
- **Test:** simultaneous draws never give out the same copy twice.

**Stage 5: Curses, steals and the full loop**
- Teams play curse cards on a target, with a range confirmation (D12).
- When a curse is played, prompt the victim to switch to 2× and the attacker to 0×. When the victim marks it cleared, prompt both to return to 1× (D9–D11, D13).
- Teams play steal cards.
- A "Reset game" for a fresh test game, and setup instructions in a README.
- **Test:** the full loop with several teams on phones.

## 8. Open questions

- **Stage 2:**
  - Does each team start with some banked time, or 0?
  - Is a team with 0 at the Elimination start eliminated immediately?
- **Stage 3:** does a replacement challenge come from a fixed ordered list or at random?
- **Stage 4:**
  - Which card types and power-ups exist, and what does each do?
  - Are there veto cards?

## 9. Progress tracker

**Current stage:** Stage 1 is complete and deployed. Next is Stage 2 (time).

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
  - Two phases only (Preparation and Elimination). Migration `0002_two_phases.sql` must be run in the Supabase SQL Editor.

### Outstanding
- Run `web/supabase/migrations/0002_two_phases.sql` in Supabase.
- Stages 2–5 (Tier 1) by Nov 1. Then the playtest, Tier 2 if there is time, and the rehearsal (section 2).
- Write the real challenge list and card deck in the content format by about Nov 4.

### Known bugs
- (none)

### Decisions log
- 2026-10-22: Team login is a team pick plus a case-insensitive code of 6+ characters. It was kept even though the spec lists accounts as Tier 3, because it already works and keeps hands private.
- 2026-10-22: Switched to the Tier 1/2/3 spec. Dropped from the original brief:
  - photo upload for theft
  - dropped-card loot at elimination
  - recording lunch locations in the app

  Rules from the original brief that the new spec doesn't mention are kept only as working defaults.
- 2026-10-22: **Only two phases, Preparation and Elimination.** Lunch is a pause. The Setup, Lunch and Ended phases were removed (migration 0002).
- 2026-10-22: **Reduce admin reliance.**
  - Teams claim, draw, use, discard and steal cards, and start and clear curses, themselves. The admin only does setup, the Elimination start (which can be scheduled), pause, and corrections.
- 2026-10-22: **Curse effects are handled manually by team-controlled countdown speed: 0×, 1× or 2× (D13).**
  - Curse length varies, because it depends on how long the victim takes to clear it.
  - While cursed, the victim runs at 2× and the attacker at 0×. In the original brief the victim was at 3×, but 3× is no longer an allowed speed, so this needs confirming.
  - Automatic siphoning stays in Tier 2.
