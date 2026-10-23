
export const PHASES = ["preparation", "elimination"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  preparation: "Preparation",
  elimination: "Elimination",
};

// Reference schedule only.
export const PHASE_SCHEDULE: Record<Phase, string> = {
  preparation: "8:00 AM – 12:00 PM, then lunch",
  elimination: "1:00 – 5:00 PM",
};

export type GameState = {
  id: number;
  phase: Phase;
  is_paused: boolean;
  phase_started_at: string;
  paused_at: string | null;
  updated_at: string;
};

export type PublicTeam = {
  id: string;
  name: string;
  status: "active" | "eliminated";
};

export type ActivityLogEntry = {
  id: number;
  created_at: string;
  team_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
};

export type ActionResult = { ok: boolean; message: string } | null;

// Each team logs in as a Supabase user whose email is derived from the team id
// and whose password is the team's secret code.
export function teamLoginEmail(teamId: string) {
  return `team-${teamId}@example.com`;
}

export const MIN_CODE_LENGTH = 6;
