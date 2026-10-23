# Time Crunch

The game website for **Jet Lag: Chicago — Time Crunch**. Teams use it on their phones to:

- claim challenges and earn time
- draw and play cards
- curse each other
- watch their countdown during the elimination phase

Organisers run the game from an admin page.

This guide is written for whoever runs the game next, including a future season. It assumes no web-development experience. For the game rules, design decisions and build history, see [CLAUDE.md](CLAUDE.md).

---

## Contents
1. [How it fits together](#1-how-it-fits-together)
2. [Setting up a new copy from scratch](#2-setting-up-a-new-copy-from-scratch)
3. [Running it on your own computer](#3-running-it-on-your-own-computer)
4. [Putting it online](#4-putting-it-online-vercel)
5. [Loading challenges and cards](#5-loading-challenges-and-cards)
6. [Running a game day](#6-running-a-game-day)
7. [Test scripts](#7-test-scripts)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. How it fits together

| Piece | What it does | Where |
|---|---|---|
| **Website** | The pages players and admins see (Next.js) | `web/` folder |
| **Supabase** | Database, logins and live updates | supabase.com |
| **Vercel** | Hosts the website at a public link | vercel.com |
| **GitHub** | Stores the code. Vercel updates the site whenever you push. | github.com |

**The server owns the game state.** All game rules run inside the database, including time, claims, draws, curses and eliminations. The phones only display the results. That's why refreshing or locking a phone never changes anyone's time.

**Logins:**
- Each **team** logs in by picking its name and typing its secret code.
- **Admins** log in with an email and password.

Teams can only see their own time, cards and draws.

**Folder layout:**

```
time crunch/
├── README.md                 ← this guide
├── CLAUDE.md                 ← rules, decisions and progress notes
├── content/                  ← example challenge and card lists (CSV)
└── web/                      ← the website
    ├── app/                  ← pages: home, login, team, admin
    ├── components/           ← shared pieces (countdown, notices, …)
    ├── lib/                  ← data loading, types, helpers
    ├── scripts/              ← test scripts (section 7)
    └── supabase/migrations/  ← database setup files, run in number order
```

---

## 2. Setting up a new copy from scratch

You need free accounts on **Supabase**, **GitHub** and **Vercel**, plus [Node.js](https://nodejs.org) (the LTS version) and [Git](https://git-scm.com) on your computer.

### 2.1 Create the database
1. Go to **supabase.com**, click **New project**, choose a region near the players (e.g. *East US (Ohio)* for Chicago), and save the database password somewhere safe.
2. When the project is ready, open **SQL Editor → New query**.
3. Run **every file** in `web/supabase/migrations/` **one at a time, in number order**, starting with `0001` and ending with the highest number. For each file:
   - open it
   - copy everything
   - paste it into the SQL Editor
   - click **Run**
   - check that it says "Success".

> ⚠ The order matters, and each file must only be run **once**. If one fails, stop and read section 8.

### 2.2 Lock down sign-ups
Open **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Only the website (for teams) and you (for admins) should be able to create accounts.

### 2.3 Create an admin account
1. Open **Authentication → Users → Add user → Create new user**. Enter an email and password, and tick **Auto Confirm User**.
2. In the **SQL Editor**, run this line with that email in place of the example:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
   It should say **1 row**. If it says 0 rows, the email doesn't exactly match the account.

Repeat these two steps for every extra admin.

### 2.4 Get the code and the keys
1. Get a copy of the code, either by cloning the GitHub repo or by copying the folder.
2. In Supabase, open **Project Settings → API Keys** (the Project URL is also under **Data API**).
3. Create a file called `.env.local` inside the `web` folder with these three lines, filled in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```
   - The **URL** is just the project address. **Don't** add `/rest/v1/` on the end.
   - The **anon / publishable** key is safe in browsers.
   - The **service role / secret** key is like a master password. **Never share it, post it or commit it.** Git already ignores `.env.local`.

---

## 3. Running it on your own computer

In a terminal (in VS Code: **Terminal → New Terminal**):

```
cd web
npm install        # first time only: downloads the libraries
npm run dev
```

Open **http://localhost:3000**. Stop the server with **Ctrl+C**.

After you change `.env.local` or run a new database file, restart with Ctrl+C and then `npm run dev`.

---

## 4. Putting it online (Vercel)

1. Create an **empty, private** repository on GitHub. Don't add a README or licence.
2. Push the code to it:
   ```
   git remote add origin https://github.com/YOUR-NAME/time-crunch.git
   git push -u origin main
   ```
3. On **vercel.com**, sign in with GitHub, then click **Add New → Project** and choose the repository.
4. Next to **Root Directory**, click **Edit** and choose `web`. This step is important.
5. Under **Environment Variables**, add the same three lines as `.env.local`.
6. Click **Deploy**. After 1–2 minutes you get a link like `time-crunch-xxxx.vercel.app`. That's the link players open on their phones.

From now on, every `git push` updates the live site automatically. Database changes, however, are always run by hand in the Supabase SQL Editor.

---

## 5. Loading challenges and cards

Keep the content in a Google Sheet and paste it into the admin page. Example files are in `content/`. To use one, open Google Sheets, go to **File → Import → Upload**, and choose the file.

### Challenges: Admin → Challenges → Import challenges
| Column | Meaning |
|---|---|
| `title` | Short name shown on the board |
| `task` | What the team has to do |
| `reward_cards` | How many cards the team draws (it keeps 1). Use 0 for none. |
| `reward_minutes` | Time bonus in minutes, added straight away. Use 0 for none. |

- Imported challenges go into a hidden **pool**. The board shows a set number at a time (10 by default; change it under "Challenges on board").
- When a challenge is claimed, a random one from the pool replaces it.

### Cards: Admin → Cards → Import cards
| Column | Meaning |
|---|---|
| `name` | Card name |
| `type` | `curse` or `powerup` |
| `copies` | How many physical copies are in the deck |
| `description` | What the card does |
| `range` | e.g. `500 m`. Shown on curses; players confirm they're within range. |
| `clearance` | The task the cursed team must do to clear the curse |
| `effect` | Blank for cards the players carry out themselves, or `duplicate` for "copy another card in your hand" |

**Notes:**
- Select the header row as well as the data rows when copying from Sheets.
- If any row has a problem, nothing is imported, and the message tells you which row to fix.
- To replace all content, use **Delete all challenges** or **Delete all cards** at the bottom of those sections, then import the new list.

---

## 6. Running a game day

### The day before
- Open the site and the Supabase dashboard. **Free Supabase projects pause after about a week without use.** If the dashboard says the project is paused, click **Restore**.
- Admin → **Reset game** (type RESET). This clears the time, claims, cards in hands, curses and the activity log from any test runs, and puts every challenge and card back. Your content and teams stay.
  - Tick **"Also delete all teams"** only if you're starting with completely new teams.
- Check that the teams exist (**Team logins**), and give each team its name and code.
- Have every team log in on at least one phone and check that they see the board.

### During the game
| When | Admin does |
|---|---|
| Morning | Leave the game in **Preparation**. Teams claim challenges and bank time; no countdowns run. |
| Lunch | Press **Pause**. Claims and card use stop, and the clocks freeze. |
| After lunch | Press **Resume**, then switch to **Elimination** and confirm. Every team's countdown starts at the same moment. Teams with 0 time are eliminated straight away. |
| Mistakes | **Team time → Edit** to add or remove time or reset a team's speed. Use **Undo** in Time history, **Clear curse** in Curses, and **Move** in Cards → Cards held by teams. |
| Emergencies | **Pause** freezes everything without costing anyone time. |

**How curses work:**
- A team plays a curse card, picks a target and confirms they're in range.
- The target's countdown runs at **2×** and the attacker's stops (**0×**) until the target taps **"curse cleared"**. Then both go back to **1×**.
- Teams can also change their speed by hand to fix mistakes.

**Keep the admin page open** on one device during Elimination. It helps the site notice the moment a team's time runs out.

---

## 7. Test scripts

Run these from inside the `web` folder. They use the keys in `.env.local`. Replace the team names and codes with real ones.

| Command | What it checks |
|---|---|
| `node --env-file=.env.local scripts/sync-check.mjs` | Checks that live updates reach browsers quickly. It should say **PASS ✓** with times well under 1000 ms. |
| `node --env-file=.env.local scripts/rls-check.mjs "Team A" codeA` | Logs in as a team and tries 34 things a team must **not** be able to do. Every line should say **BLOCKED ✓**. Run it after every database change. |
| `node --env-file=.env.local scripts/race-claim.mjs "Team A" codeA "Team B" codeB` | Two teams claim the same challenge at the same instant. Exactly one should win. ⚠ This really claims 2 challenges. |
| `node --env-file=.env.local scripts/race-draw.mjs "Team A" codeA "Team B" codeB` | Two teams draw cards at the same instant. No card should go to both. ⚠ Each team keeps a real card. |

Run **Reset game** after testing.

---

## 8. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| "Invalid path specified in request URL" | `NEXT_PUBLIC_SUPABASE_URL` has `/rest/v1/` on the end. Remove it and restart. |
| "relation … does not exist" or "Could not find the function …" | A database file in `web/supabase/migrations/` hasn't been run. Run the missing ones in order. |
| "null" or blank text after an action | Usually the same cause: the newest database file hasn't been run. |
| A database file fails with "already exists" | It was already run once. Don't run it again; continue with the next number. |
| Updates are slow or missing | Run `scripts/sync-check.mjs` (section 7). If it fails, check that every database file has been run, including `0010_sync_broadcast.sql`. |
| A team's page doesn't update | It updates live, and reloads every 20 seconds anyway. If it seems stuck, refresh the page. Locking the phone and unlocking it also triggers a reload. |
| Admin login says "This account is not an admin" | Run the `insert into public.admins …` line from section 2.3 for that email. |
| A team forgot its code | Admin → Team logins → Edit → Set code. |
| The board isn't full | The challenge pool has run out. Import more challenges. |
| Teams can't draw ("The deck is empty") | Every card is in someone's hand. Add copies (**+1**) or import more cards. |
| "deadlock detected" when playing a curse | Two teams cursed each other at exactly the same moment. Tap **Use** again. |
| The live site still shows old code | Check the Vercel dashboard for a failed deployment, and that you ran `git push`. |

### Making changes to the database later
Never edit a migration file that has already been run. Add a new file with the next number instead (e.g. `0010_….sql`), run it in the SQL Editor, and commit it. That way a fresh setup (section 2.1) always gets everything in the right order.
