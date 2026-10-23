"use server";

import { getUserId, isAdmin } from "@/lib/auth";
import { parseTable } from "@/lib/csv";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CARD_EFFECTS,
  CARD_TYPES,
  MIN_CODE_LENGTH,
  PHASES,
  SPEEDS,
  teamLoginEmail,
  type ActionResult,
  type Phase,
  type Speed,
} from "@/lib/types";

// Every action re-checks admin rights on the server. Never trust that the
// button was only visible to admins.
async function requireAdmin(): Promise<string | null> {
  if (!(await isAdmin())) return null;
  return getUserId();
}

const NOT_ADMIN: ActionResult = { ok: false, message: "You are not logged in as admin." };

function cleanName(raw: FormDataEntryValue | null) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanCode(raw: FormDataEntryValue | null) {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function validateName(name: string) {
  if (name.length < 1 || name.length > 40) return "Team name must be 1–40 characters.";
  return null;
}

function validateCode(code: string) {
  if (code.length < MIN_CODE_LENGTH) return `Code must be at least ${MIN_CODE_LENGTH} characters.`;
  return null;
}

async function log(actorUserId: string, eventType: string, teamId: string | null, details: object) {
  await createAdminClient()
    .from("activity_log")
    .insert({ actor_user_id: actorUserId, event_type: eventType, team_id: teamId, details });
}

// ---------------------------------------------------------------------------
// Game state (the database functions also check admin rights and log)
// ---------------------------------------------------------------------------

export async function setPhase(phase: Phase): Promise<ActionResult> {
  if (!PHASES.includes(phase)) return { ok: false, message: "Unknown phase." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_phase", { new_phase: phase });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Phase changed." };
}

export async function setPaused(paused: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_paused", { paused });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: paused ? "Game paused." : "Game resumed." };
}

// ---------------------------------------------------------------------------
// Time (the database functions check admin rights, settle clocks and log)
// ---------------------------------------------------------------------------

export async function adjustTime(teamId: string, formData: FormData): Promise<ActionResult> {
  const minutes = Number(formData.get("minutes"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(minutes) || minutes === 0) {
    return { ok: false, message: "Enter a number of minutes (use a minus sign to subtract)." };
  }
  if (!reason) return { ok: false, message: "Please give a reason." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_adjust_time", {
    p_team: teamId,
    delta_seconds: Math.round(minutes * 60),
    reason,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `${minutes > 0 ? "Added" : "Removed"} ${Math.abs(minutes)} min.` };
}

export async function setTeamSpeed(teamId: string, speed: Speed): Promise<ActionResult> {
  if (!SPEEDS.includes(speed)) return { ok: false, message: "Unknown speed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_speed", { p_team: teamId, new_speed: speed });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Speed set to ${speed}×.` };
}

export async function setTeamStatus(teamId: string, status: "active" | "eliminated"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_team_status", { p_team: teamId, new_status: status });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: status === "active" ? "Team is back in the game." : "Team eliminated." };
}

export async function undoTimeEntry(entryId: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reverse_entry", { entry_id: entryId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Undid entry #${entryId}.` };
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

type ChallengeFields = { title: string; task: string; reward_cards: number; reward_minutes: number };

function validateChallenge(c: ChallengeFields): string | null {
  if (c.title.length < 1 || c.title.length > 100) return "Title must be 1–100 characters.";
  if (!Number.isInteger(c.reward_cards) || c.reward_cards < 0 || c.reward_cards > 10) {
    return "Card reward must be a whole number from 0 to 10.";
  }
  if (!Number.isInteger(c.reward_minutes) || c.reward_minutes < 0 || c.reward_minutes > 600) {
    return "Time bonus must be a whole number of minutes from 0 to 600.";
  }
  return null;
}

// Expects rows pasted from a spreadsheet with headers:
// title, task, reward_cards, reward_minutes
export async function importChallenges(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const rows = parseTable(String(formData.get("table") ?? ""));
  if (rows.length === 0) {
    return {
      ok: false,
      message: "Paste a header row (title, task, reward_cards, reward_minutes) and at least one challenge.",
    };
  }
  if (!("title" in rows[0])) {
    return { ok: false, message: 'The first row must be the headers, including "title".' };
  }

  const challenges: ChallengeFields[] = [];
  for (const [i, row] of rows.entries()) {
    const challenge = {
      title: row.title ?? "",
      task: row.task ?? "",
      reward_cards: Number(row.reward_cards || 0),
      reward_minutes: Number(row.reward_minutes || 0),
    };
    const problem = validateChallenge(challenge);
    // i + 2: spreadsheet row number (row 1 is the headers).
    if (problem) return { ok: false, message: `Row ${i + 2} ("${challenge.title}"): ${problem} Nothing was imported.` };
    challenges.push(challenge);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_challenges", { p_rows: challenges });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Imported ${data} challenge${data === 1 ? "" : "s"}.` };
}

export async function updateChallenge(challengeId: string, formData: FormData): Promise<ActionResult> {
  const challenge = {
    title: String(formData.get("title") ?? "").trim(),
    task: String(formData.get("task") ?? "").trim(),
    reward_cards: Number(formData.get("reward_cards")),
    reward_minutes: Number(formData.get("reward_minutes")),
  };
  const problem = validateChallenge(challenge);
  if (problem) return { ok: false, message: problem };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_challenge", {
    p_challenge: challengeId,
    p_title: challenge.title,
    p_task: challenge.task,
    p_reward_cards: challenge.reward_cards,
    p_reward_minutes: challenge.reward_minutes,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Saved." };
}

export async function setChallengeStatus(challengeId: string, status: "retired" | "pool"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_challenge_status", { p_challenge: challengeId, new_status: status });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: status === "retired" ? "Challenge removed." : "Challenge back in the pool." };
}

export async function setBoardSize(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const size = Number(formData.get("size"));
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    return { ok: false, message: "Board size must be a whole number from 1 to 50." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_board_size", { new_size: size });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Board now shows ${size} challenges.` };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

// Expects rows pasted from a spreadsheet with headers:
// name, type, copies, description, range, clearance, effect
export async function importCards(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const rows = parseTable(String(formData.get("table") ?? ""));
  if (rows.length === 0 || !("name" in rows[0])) {
    return {
      ok: false,
      message: "Paste a header row (name, type, copies, description, range, clearance, effect) and at least one card.",
    };
  }

  const cards = [];
  for (const [i, row] of rows.entries()) {
    const card = {
      name: (row.name ?? "").trim(),
      type: (row.type ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, ""), // "Power-up" -> "powerup"
      copies: Number(row.copies || 1),
      description: row.description ?? "",
      range_text: row.range ?? "",
      clearance: row.clearance ?? "",
      effect: (row.effect ?? "").trim().toLowerCase(),
    };
    const where = `Row ${i + 2} ("${card.name}")`;
    if (card.name.length < 1 || card.name.length > 60)
      return { ok: false, message: `${where}: name must be 1–60 characters. Nothing was imported.` };
    if (!(CARD_TYPES as readonly string[]).includes(card.type)) {
      return { ok: false, message: `${where}: type must be one of ${CARD_TYPES.join(", ")}. Nothing was imported.` };
    }
    if (!Number.isInteger(card.copies) || card.copies < 1 || card.copies > 50) {
      return { ok: false, message: `${where}: copies must be a whole number from 1 to 50. Nothing was imported.` };
    }
    if (card.effect && !(CARD_EFFECTS as readonly string[]).includes(card.effect)) {
      return {
        ok: false,
        message: `${where}: effect must be blank or one of ${CARD_EFFECTS.join(", ")}. Nothing was imported.`,
      };
    }
    cards.push(card);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_cards", { p_rows: cards });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Imported ${cards.length} card type(s), ${data} copies in total.` };
}

export async function updateCardType(typeId: string, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 60) return { ok: false, message: "Name must be 1–60 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_card_type", {
    p_type: typeId,
    p_name: name,
    p_description: String(formData.get("description") ?? ""),
    p_range: String(formData.get("range") ?? ""),
    p_clearance: String(formData.get("clearance") ?? ""),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Saved." };
}

export async function changeCopies(typeId: string, change: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_change_copies", { p_type: typeId, p_change: change });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: change > 0 ? "Added a copy to the deck." : "Removed a copy from the deck." };
}

// teamId null = back to the deck.
export async function moveCard(cardId: string, teamId: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_move_card", { p_card: cardId, p_team: teamId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: teamId ? "Card moved." : "Card returned to the deck." };
}

export async function grantDraw(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const teamId = String(formData.get("team") ?? "");
  const size = Number(formData.get("size"));
  if (!teamId) return { ok: false, message: "Choose a team." };
  if (!Number.isInteger(size) || size < 1 || size > 10) return { ok: false, message: "Draw size must be 1–10." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant_draw", { p_team: teamId, p_size: size });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Gave a draw of ${size}.` };
}

// ---------------------------------------------------------------------------
// Curses, deleting content, resetting the game
// ---------------------------------------------------------------------------

export async function adminClearCurse(curseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_clear_curse", { p_curse: curseId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Curse cleared. Both teams' countdowns are back to 1× (the attacker stays at 0× if it has another curse active)." };
}

export async function deleteAllChallenges(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_all_challenges");
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Deleted ${data} challenge(s).` };
}

export async function deleteAllCards(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_all_cards");
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Deleted all card types and ${data} card(s).` };
}

// Clears all play (time, history, claims, hands, draws, curses, log) but keeps
// challenges and cards. Optionally deletes every team and its login too.
export async function resetGame(deleteTeams: boolean): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reset_game");
  if (error) return { ok: false, message: error.message };

  if (deleteTeams) {
    const admin = createAdminClient();
    const { data: teams } = await admin.from("teams").select("id, user_id");
    for (const team of teams ?? []) {
      await admin.from("teams").delete().eq("id", team.id);
      if (team.user_id) await admin.auth.admin.deleteUser(team.user_id);
    }
    await log(adminId, "teams_deleted_in_reset", null, { count: teams?.length ?? 0 });
  }

  return {
    ok: true,
    message: deleteTeams
      ? "Game reset and all teams deleted. Create the new teams under Team logins."
      : "Game reset: everyone is back to Preparation with 0 time.",
  };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function createTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const name = cleanName(formData.get("name"));
  const code = cleanCode(formData.get("code"));
  const problem = validateName(name) ?? validateCode(code);
  if (problem) return { ok: false, message: problem };

  const admin = createAdminClient();
  // Case-insensitive duplicate check (escape LIKE wildcards in the name).
  const { data: existing } = await admin
    .from("teams")
    .select("id")
    .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (existing) return { ok: false, message: `A team called "${name}" already exists.` };

  const teamId = crypto.randomUUID();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: teamLoginEmail(teamId),
    password: code,
    email_confirm: true,
  });
  if (userError) return { ok: false, message: `Could not create login: ${userError.message}` };

  const { error: teamError } = await admin.from("teams").insert({ id: teamId, name, user_id: created.user.id });
  if (teamError) {
    // Undo the login account so we don't leave an orphan behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: `Could not create team: ${teamError.message}` };
  }

  await log(adminId, "team_created", teamId, { name });
  return { ok: true, message: `Created "${name}". Their code is: ${code}` };
}

export async function renameTeam(teamId: string, formData: FormData): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const name = cleanName(formData.get("name"));
  const problem = validateName(name);
  if (problem) return { ok: false, message: problem };

  const { data, error } = await createAdminClient().from("teams").update({ name }).eq("id", teamId).select("id");
  if (error) {
    const message = error.code === "23505" ? `A team called "${name}" already exists.` : error.message;
    return { ok: false, message };
  }
  if (!data?.length) return { ok: false, message: "Team not found." };

  await log(adminId, "team_renamed", teamId, { name });
  return { ok: true, message: `Renamed to "${name}".` };
}

export async function resetTeamCode(teamId: string, formData: FormData): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const code = cleanCode(formData.get("code"));
  const problem = validateCode(code);
  if (problem) return { ok: false, message: problem };

  const admin = createAdminClient();
  const { data: team } = await admin.from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (!team?.user_id) return { ok: false, message: "Team not found." };

  const { error } = await admin.auth.admin.updateUserById(team.user_id, { password: code });
  if (error) return { ok: false, message: error.message };

  await log(adminId, "team_code_reset", teamId, {});
  return { ok: true, message: `New code: ${code}` };
}

export async function deleteTeam(teamId: string): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const admin = createAdminClient();
  const { data: team } = await admin.from("teams").select("name, user_id").eq("id", teamId).maybeSingle();
  if (!team) return { ok: false, message: "Team not found." };

  const { error } = await admin.from("teams").delete().eq("id", teamId);
  if (error) return { ok: false, message: error.message };
  if (team.user_id) await admin.auth.admin.deleteUser(team.user_id);

  await log(adminId, "team_deleted", null, { name: team.name });
  return { ok: true, message: `Deleted "${team.name}".` };
}
