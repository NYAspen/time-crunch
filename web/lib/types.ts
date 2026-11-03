
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
  hand_limit: number; // most cards a team may hold (migration 0012)
};

// The speeds teams and the admin can pick by hand. Curses shift a team's speed
// by 1 each (migration 0011), so the actual speed can be below 0 or above 2.
export const SPEEDS = [0, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export type PublicTeam = {
  id: string;
  name: string;
  status: "active" | "eliminated";
  speed: number;
  eliminated_at: string | null;
  hand_bonus: number; // extra hand-limit slots from "hand +N" cards (migration 0015)
};

// Private: a team can only read its own clock; admins can read all.
// Self-contained snapshot: everything needed to show the countdown is in this
// one row, so the screen never mixes old and new values.
export type TeamClock = {
  team_id: string;
  balance_ms: number;
  anchor_at: string;
  speed: number;
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

// Automatic effects (migration 0015). Cards with no effect are carried out by the players.
//   duplicate      copy another card in your hand
//   steal          take a random card from another team (Elimination, in range)
//   veto           cancel a curse on you, or take back a card stolen in the last 60 s
//   draw X pick Y  a new draw: X cards shown, keep Y (X up to 10)
//   hand +N        hand limit +N for the rest of the game (N up to 9)
export const CARD_EFFECTS_HELP = "duplicate, steal, veto, draw X pick Y (e.g. draw 4 pick 2), hand +N (e.g. hand +1)";
export type CardEffect = string;

export type ParsedEffect =
  | { kind: "none" }
  | { kind: "duplicate" | "steal" | "veto" }
  | { kind: "draw"; size: number; keep: number }
  | { kind: "hand"; bonus: number };

// null if the text isn't a valid effect.
export function parseEffect(effect: string | null): ParsedEffect | null {
  if (!effect) return { kind: "none" };
  if (effect === "duplicate" || effect === "steal" || effect === "veto") return { kind: effect };
  const draw = /^draw (\d+) pick (\d+)$/.exec(effect);
  if (draw) {
    const size = Number(draw[1]);
    const keep = Number(draw[2]);
    return size >= 1 && size <= 10 && keep >= 1 && keep <= size ? { kind: "draw", size, keep } : null;
  }
  const hand = /^hand \+([1-9])$/.exec(effect);
  if (hand) return { kind: "hand", bonus: Number(hand[1]) };
  return null;
}

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
  keep: number; // how many of the shown cards the team keeps (migration 0015)
  kept: number;
  source: string;
  status: "pending" | "open" | "done";
  created_at: string;
};

// A recent team action the team can still undo (migration 0013).
export type TeamUndo = {
  id: string;
  team_id: string;
  kind: "claim" | "use" | "discard" | "clear_curse" | "veto";
  label: string;
  created_at: string;
  expires_at: string;
};

// Teams see curses they played or that are on them (RLS); admins see all.
export type Curse = {
  id: string;
  attacker_team: string;
  target_team: string;
  card_name: string;
  range_text: string;
  clearance: string;
  status: "active" | "cleared";
  started_at: string;
  cleared_at: string | null;
};

// A card taken by a steal card. Teams see steals they made or suffered (RLS).
// The victim can veto until veto_until (migration 0015).
export type Steal = {
  id: string;
  attacker_team: string;
  target_team: string;
  card_name: string;
  created_at: string;
  veto_until: string;
  vetoed_at: string | null;
};

export type ActivityLogEntry = {
  id: number;
  created_at: string;
  team_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
  undone_at: string | null;
};

export type ActionResult = { ok: boolean; message: string } | null;

// Each team logs in as a Supabase user whose email is derived from the team id
// and whose password is the team's secret code.
export function teamLoginEmail(teamId: string) {
  return `team-${teamId}@example.com`;
}

export const MIN_CODE_LENGTH = 6;
