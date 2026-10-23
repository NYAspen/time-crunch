
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
  board_size: number;
};

export const SPEEDS = [0, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export type PublicTeam = {
  id: string;
  name: string;
  status: "active" | "eliminated";
  speed: Speed;
  eliminated_at: string | null;
};

// Private: a team can only read its own clock; admins can read all.
// Self-contained snapshot: everything needed to show the countdown is in this
// one row, so the screen never mixes old and new values.
export type TeamClock = {
  team_id: string;
  balance_ms: number;
  anchor_at: string;
  speed: Speed;
  running: boolean;
};

export type LedgerEntry = {
  id: number;
  created_at: string;
  team_id: string;
  kind: "adjust" | "reversal" | "speed" | "eliminated" | "revived" | "challenge";
  delta_ms: number;
  balance_after_ms: number;
  reason: string | null;
  details: Record<string, unknown>;
  reversed_by: number | null;
};

export type Challenge = {
  id: string;
  title: string;
  task: string;
  reward_cards: number;
  reward_minutes: number;
  // Teams only ever receive "active" and "claimed" (RLS); admins see all.
  status: "pool" | "active" | "claimed" | "retired";
  activated_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
};

export const CARD_TYPES = ["curse", "powerup"] as const;
export type CardTypeKind = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABELS: Record<CardTypeKind, string> = { curse: "Curse", powerup: "Power-up" };

// Automatic effects. Cards with no effect are carried out by the players.
export const CARD_EFFECTS = ["duplicate"] as const;
export type CardEffect = (typeof CARD_EFFECTS)[number];

export type CardType = {
  id: string;
  name: string;
  type: CardTypeKind;
  description: string;
  range_text: string;
  clearance: string;
  effect: CardEffect | null;
};

// One physical copy. Teams only receive their own (RLS); admins see all.
export type Card = {
  id: string;
  type_id: string;
  status: "deck" | "offered" | "hand" | "removed";
  holder_team: string | null;
  draw_id: string | null;
  is_duplicate: boolean;
};

export type CardDraw = {
  id: string;
  team_id: string;
  size: number;
  source: string;
  status: "pending" | "open" | "done";
  created_at: string;
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
