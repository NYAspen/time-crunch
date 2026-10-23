# Project: Jet Lag: Chicago — Time Crunch

## 1. Your role and priorities

Help me build a simple, mobile-friendly website for a team-based game called **Jet Lag: Chicago — Time Crunch**.

I have approximately one week to build this and limited web development experience. Guide me through setup and implementation step by step. Explain which commands to run, which accounts or services to set up, and what I need to do manually.

Priorities:
1. Correct game mechanics and reliable shared state.
2. A simple interface that works well on phones.
3. Secure separation of public game information and private team information.
4. Easy administration during the live game.
5. Visual polish only after the core mechanics work.

Use Next.js and Supabase if appropriate. Choose the simplest reliable architecture, and do not implement every feature at once.

## 2. Game structure

The game has multiple teams. Each team has:
- A team name and login/access method.
- A banked time balance.
- A countdown timer during the elimination phase.
- A private inventory of cards.
- A current reported location.
- A status: active or eliminated.
- Any active curse effects.

The game has three scheduled periods:

- **Preparation:** 8:00 AM–12:00 PM. Teams complete challenges, collect cards, and build up their time balance. There is no countdown or elimination.
- **Lunch:** 12:00–1:00 PM. Freeze gameplay and timers. Teams record their location at noon and are expected to return there for the start of the next phase.
- **Elimination:** 1:00–5:00 PM. Each team's timer counts down. Teams that reach zero are eliminated.

An administrator must be able to switch the game from Preparation to Elimination for all teams in one action. The phase transition should happen consistently for every team, not separately as each team opens the website. The admin must also be able to pause and resume gameplay if necessary.

Use server-authoritative game state so refreshing a page, closing a phone, or losing connection does not reset or incorrectly advance timers.

## 3. Teams, access, and privacy

Create an admin interface and a team interface.

**Admin can:**
- Create and edit teams.
- Create and edit challenges and cards.
- View all teams, their time balances, reported locations, active curses, and elimination status.
- Switch phases, pause/resume the game, and correct data when necessary.
- View the event's overall state.

**Teams can:**
- View the shared challenge board.
- Claim a challenge they completed.
- Draw cards when eligible.
- View their own inventory and time balance.
- Report their current location.
- Use eligible cards and complete curse-clearance tasks.
- View public information about other teams, such as team names, reported locations, and active/eliminated status.

Teams must not be able to change another team's time, inventory, status, or location by editing requests or manipulating the website. Keep private inventories and other sensitive team data private. Validate important actions on the server.

## 4. Challenge board

The challenge board is shared by all teams.

Each challenge has:
- A title.
- A description of the task.
- Any location or completion requirements.
- A reward specifying how many cards the winning team draws.
- An active/completed status.

The board should maintain a configurable number of active challenges, initially around 5–15.

**Claiming a challenge:**
1. A team completes a challenge in the real world.
2. They submit a claim through the website.
3. The server checks whether the challenge is still available and the game phase permits claims.
4. The first valid claim succeeds.
5. The winning team receives the challenge's specified card draw.
6. The completed challenge disappears from the active board and a new challenge is generated or selected to replace it.

If multiple teams claim the same challenge at nearly the same time, only one team may win. Use an atomic server/database operation rather than relying on the order in which clients update their screens.

Teams self-report completion. Do not require an admin to approve every claim. Include basic protection against duplicate submissions.

Challenges should stop being claimable when the game enters a phase in which challenge claims are disabled. Make this behavior configurable if needed.

## 5. Card deck and drawing

Create one shared, shuffled deck of card copies. Different copies may have identical effects, but each physical card copy in the game must have a unique identifier.

Each card has:
- A unique ID.
- A name and description.
- A card type.
- Its effect or value.
- Any relevant parameters, such as duration, radius, or clearance task.

When a challenge rewards a draw of N cards:
1. Draw N cards from the shared deck.
2. Show the drawn cards to the team.
3. The team chooses one card to keep.
4. Return the unchosen cards to the shared deck and shuffle them back in.
5. Add the chosen card to the team's inventory.

Ensure that simultaneous draws cannot give the same card copy to two teams. Use server-side transactions or another reliable atomic mechanism.

If there are not enough cards available, handle this explicitly rather than duplicating cards or silently failing.

The regular card-hand limit is initially **7 cards per team**. Time rewards are stored in the team's time balance rather than occupying regular inventory slots. Define what happens if a team would exceed the hand limit: prevent the draw until the team can legally resolve it, or ask the team to discard a card. Make the rule configurable.

## 6. Time cards and time balances

Some cards grant a specified amount of time, such as 10, 15, 20, or 30 minutes.

Time rewards should be added to a separate time balance, not counted toward the regular card-hand limit. Implement the time-card redemption behavior clearly: if a time card must be redeemed, the team should explicitly redeem it and the balance should update exactly once.

During Preparation:
- Teams accumulate time.
- There is no running countdown.
- Teams cannot be eliminated due to time reaching zero.

At the start of Elimination:
- Each team's countdown is initialized from its banked time.
- The countdown runs at one second per real second while the game is active and unpaused.
- A team is eliminated when its remaining time reaches zero.

Store timer state using a server-side timestamp and remaining-time value, or an equivalent reliable design. Do not depend on a browser interval as the source of truth. The displayed timer should recover accurately after refreshes, sleep, disconnection, or reopening the site.

## 7. Attacks, theft, and curses

The card system may include:
- **Theft cards:** Allow a team to steal a card from another team, according to the card's rules.
- **Curse cards:** Apply a time effect to a target team until it completes a specified clearance task.
- **Veto or power-up cards:** Implement their effects according to the card's configured description.

A card can only be used if it is in the team's inventory and is valid for the current phase. A successful use should consume the card unless its rules explicitly say otherwise.

### Theft

For a photo-based theft card:
- The attacker must satisfy the card's targeting/range requirements.
- The attacker submits the required photo or confirmation.
- On a valid use, steal one random eligible card from the target's inventory.
- Transfer the card copy; do not duplicate it.
- Apply a five-minute cooldown to the relevant theft action or card as configured.
- Prevent simultaneous theft actions from transferring the same card twice.

Do not build complicated image verification unless time permits. A simple upload or record of the required photo may be enough for the first version.

### Curses

A curse has:
- An attacker.
- A target.
- A radius or targeting requirement.
- A clearance task.
- An active/inactive status.
- A record of when it began and ended.

For the initial version, a team can have at most one active curse at a time. Reject or clearly handle an attempted curse on a team that is already cursed.

While a curse is active during Elimination:
- The victim loses time at an additional rate of two minutes per real minute.
- The attacker gains one minute per real minute.
- The victim's ordinary countdown still runs at one minute per real minute.
- Therefore, the victim loses a total of three minutes per real minute while cursed, and the attacker gains one minute per real minute.
- These changes must be calculated accurately from timestamps, not by trusting a browser to send repeated timer updates.

The curse ends when the victim completes the specified clearance task and records that completion in the website. The curse should not automatically end just because the victim leaves the curse's radius.

Define carefully how the effect is accounted for when the curse begins, ends, or the game pauses, so neither team gains or loses extra time from refreshes or delayed requests. Do not apply curse time effects during Preparation or while gameplay is paused.

## 8. Locations and radius checks

For the first version, use **manual location reporting** rather than requiring continuous GPS.

Each team can update its current location. Show reported locations on a shared map if this can be implemented simply; otherwise, a clear location list is acceptable.

Location rules:
- Other teams can see each team's latest reported location.
- A team's current location is the latest location it submitted.
- Radius-based actions compare the relevant teams' latest reported locations.
- Leaving a radius does not automatically cancel an already-active curse.
- Record when each location was last updated so players understand that locations may be stale.

If feasible, use a simple map library with OpenStreetMap. Do not spend significant time building advanced GPS tracking. Make radius calculations server-side and clearly communicate that manual location reports are not independently verified.

## 9. Lunch and phase transition

At noon, Preparation ends and gameplay freezes for lunch.

- Stop accepting challenge claims and new card actions.
- Pause all game timers and curse effects.
- Record each team's latest reported location as its lunch/start location.
- Show teams their recorded location and remind them to return there for the Elimination start.
- Do not assume the website can enforce where players physically go.

At 1:00 PM, the admin triggers the Elimination phase:
- Initialize every team's countdown from its banked time.
- Start all countdowns from the same authoritative phase-transition time.
- Resume normal game rules.
- Do not let teams start their clocks at different times just because they opened the website at different times.

If the admin pauses the game later, freeze countdowns and curse effects. When the game resumes, continue from the remaining time without charging time for the pause.

## 10. Elimination and dropped cards

When a team's timer reaches zero during Elimination:
- Mark the team eliminated exactly once.
- Stop that team's ability to claim challenges, draw cards, use attacks, or otherwise act as an active team.
- Record the time and the team's latest reported location at elimination.
- Make the team's remaining cards available for collection at that location, following the game's loot rules.
- Do not transfer the eliminated team's banked time unless a specific rule says to.

The website should make it clear where an eliminated team's cards are available. The contents may remain hidden until a team successfully claims the loot, if practical.

Ensure that two teams cannot claim the same loot or card copy simultaneously.

## 11. Admin controls and live-game reliability

The admin dashboard is especially important because it will be used during a live event.

Include:
- Current phase and pause status.
- A global phase-switch control with confirmation.
- A pause/resume control.
- A list of all teams with time, status, location, and active curse.
- Challenge management.
- Card/deck management.
- A way to fix mistakes, such as correcting a team's time or undoing an accidental action.
- Clear error messages when an action fails.

Record important events in a basic activity log, including challenge wins, card draws, card uses, time changes, curse starts/ends, phase transitions, pauses, and eliminations. Include timestamps and affected teams.

## 12. Security and data integrity

Do not trust client-side data for:
- Remaining time.
- Whether a challenge is still available.
- Whether a card is owned or usable.
- Whether a team is eliminated.
- Whether a curse is active.
- Whether a team is within attack radius.
- Whether a card or loot claim has already been completed.

Validate all consequential actions on the server. Use database constraints, transactions, and authorization rules wherever appropriate. Never expose secret service-role keys in browser code. Configure Supabase Row Level Security and test that one team cannot access or modify another team's private data.

## 13. Implementation plan

Build the project in small, testable stages. Do not attempt to implement everything at once.

**Stage 1 — Setup and interface**
- Create the project and connect the database.
- Implement admin access and team access.
- Create teams and display the current game phase.
- Verify that two different devices see the same shared state.

**Stage 2 — Challenges**
- Build the shared challenge board.
- Implement challenge claiming and replacement.
- Test two teams claiming the same challenge simultaneously.

**Stage 3 — Cards**
- Implement the shared deck, drawing, choosing one card, returning the rest, inventory, and hand limit.
- Test concurrent draws and ensure no card copy can be duplicated.

**Stage 4 — Time**
- Implement banked time, redemption, phase transition, countdown, pause/resume, and elimination.
- Test refreshing the page and reopening it after waiting.

**Stage 5 — Attacks**
- Implement manual location updates, range checks, theft, curses, and clearance tasks.
- Test curse timing across refreshes and pauses.

**Stage 6 — Loot and final testing**
- Implement elimination loot and single-claim protection.
- Test the full game with a few fake teams on multiple devices.
- Fix critical bugs before adding optional features.

## 14. How I want you to work with me

Start with **Stage 1 only**.

For each step:
1. Tell me exactly what to do, including commands and where to run them.
2. Tell me when I need to create an account, set an environment variable, or edit a dashboard setting.
3. Implement a small, working feature.
4. Explain how I can test it.
5. Help debug errors before moving on.

Keep explanations concise and practical. Do not assume I know web-development terminology. Do not generate the entire application in one large code dump. Do not add optional mechanics such as a collapsing border or a boogeyman until the core game works.

If a rule is ambiguous, identify the ambiguity and recommend a simple default before implementing it. Maintain a written list of implemented features, outstanding tasks, and known bugs so we can finish a reliable minimum viable product within one week.

---

## 15. Progress tracker

Keep this section up to date as work proceeds.

**Current stage:** Stage 1. Supabase is set up and local testing (Part D) passed on 2026-10-22. Deploying to Vercel next.

### Architecture notes
- App lives in `web/` (Next.js 16 App Router + TypeScript + Tailwind; Cache Components enabled, so request-time reads such as cookies must be inside `<Suspense>`). Next 16 renamed middleware to `proxy.ts`. Read `web/node_modules/next/dist/docs/` before using unfamiliar Next APIs.
- Supabase: Postgres + Auth + Realtime. SQL migrations are in `web/supabase/migrations/` and are run by hand in the Supabase SQL Editor.
- Browsers only READ, and RLS limits what they can read. Writes go through security-definer Postgres functions (RPC), which check `is_admin()`, or through server actions in `app/**/actions.ts`, which re-check admin and then use the secret key (`lib/supabase/admin.ts`, server-only).
- Team login: each team is a Supabase Auth user with email `team-<teamId>@example.com` and the team's secret code as password. Codes are lowercased, so login is case-insensitive.
- Live UI: the `components/useLiveTable.ts` hook reloads on Realtime changes, on tab visibility and when the device comes back online.
- Env vars live in `web/.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (secret)

### Implemented features
- Stage 1 (tested locally against Supabase: live updates, login, RLS check):
  - DB schema: `game_state`, `teams`, `admins` and `activity_log`, plus RLS, `admin_set_phase` / `admin_set_paused` RPCs and Realtime.
  - Landing page, team login (pick team + code) and team page (name, live phase banner, live team list).
  - Admin login and admin dashboard:
    - phase switch with confirmation
    - pause/resume
    - create, rename, reset code and delete teams
    - live activity log
  - `web/scripts/rls-check.mjs`: logs in as a team and verifies that forbidden writes and reads are blocked.

### Outstanding tasks
- Stage 1 remaining:
  - push to GitHub
  - deploy to Vercel (Root Directory = `web`, add the 3 env vars)
  - test on two phones using the Vercel URL
- Stages 2–6 as listed in section 13.

### Known bugs
- (none yet)

### Decisions on ambiguous rules
Record each ambiguity, the chosen default, and the date decided.
- 2026-10-22: Phase changes are manual by the admin. The 8/12/1/5 times are shown only as a reference schedule.
- 2026-10-22: Added a `setup` phase before Preparation (for creating teams) and an `ended` phase after Elimination.
- 2026-10-22: Pause is independent of phase. The admin can pause in any phase.
- 2026-10-22: Team codes are at least 6 characters (Supabase minimum) and case-insensitive.
- 2026-10-22: Team login = pick team name + secret code; hosting = Vercel via GitHub.
