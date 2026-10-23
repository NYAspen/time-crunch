"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { teamLoginEmail, type ActionResult } from "@/lib/types";

export async function teamLogin(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const teamId = String(formData.get("teamId") ?? "");
  // Codes are case-insensitive so phone auto-capitalisation doesn't matter.
  const code = String(formData.get("code") ?? "").trim().toLowerCase();

  if (!teamId || !code) {
    return { ok: false, message: "Pick your team and enter your code." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: teamLoginEmail(teamId),
    password: code,
  });
  if (error) {
    return { ok: false, message: "That code is not right for this team. Check with your admin." };
  }

  redirect("/team");
}
