"use server";

import { getUserId, isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
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
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function cleanCode(raw: FormDataEntryValue | null) {
  return String(raw ?? "").trim().toLowerCase();
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

  const { error: teamError } = await admin
    .from("teams")
    .insert({ id: teamId, name, user_id: created.user.id });
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

  const { data, error } = await createAdminClient()
    .from("teams")
    .update({ name })
    .eq("id", teamId)
    .select("id");
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
