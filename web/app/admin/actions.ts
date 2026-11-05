"use server";

import { getUserId, isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_CODE_LENGTH, teamLoginEmail, type ActionResult } from "@/lib/types";

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

// Keeps a copy the admin can read: the login password itself can't be read back.
// Returns a warning to show if that failed (the login still works).
async function saveCode(teamId: string, code: string) {
  const { error } = await createAdminClient()
    .from("team_codes")
    .upsert({ team_id: teamId, code, updated_at: new Date().toISOString() });
  return error ? ` Write it down: it could not be saved for the admin page (${error.message}).` : "";
}

// ---------------------------------------------------------------------------
// Team logins (need the secret key, so these run on the server)
// ---------------------------------------------------------------------------

// Used by "Reset game" when "Also delete all teams" is ticked.
export async function deleteAllTeams(): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return NOT_ADMIN;

  const admin = createAdminClient();
  const { data: teams } = await admin.from("teams").select("id, user_id");
  for (const team of teams ?? []) {
    await admin.from("teams").delete().eq("id", team.id);
    if (team.user_id) await admin.auth.admin.deleteUser(team.user_id);
  }
  await log(adminId, "teams_deleted_in_reset", null, { count: teams?.length ?? 0 });
  return { ok: true, message: `Deleted ${teams?.length ?? 0} team(s).` };
}

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

  const warning = await saveCode(teamId, code);
  await log(adminId, "team_created", teamId, { name });
  return { ok: true, message: `Created "${name}". Their code is: ${code}.${warning}` };
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

  const warning = await saveCode(teamId, code);
  await log(adminId, "team_code_reset", teamId, {});
  return { ok: true, message: `New code: ${code}.${warning}` };
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
