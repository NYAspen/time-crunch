
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


export type PublicTeam = {
  id: string;
  name: string;
  status: "active" | "eliminated";
  eliminated_at: string | null;
  hand_bonus: number; // extra hand-limit slots from "hand +N" cards (migration 0015)
  reward_multiplier: number; // "reward xN" waiting for the team's next challenge (migration 0019)
};

// Admin only: a team's login code (migration 0022). Teams created before that
// have none until the admin sets it again.
export type TeamCode = {
  team_id: string;
  code: string;
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
  location: string; // where it can be done; blank = anywhere
  reward_cards: number;
  reward_keep: number; // cards kept from the draw ("draw 4 pick 2")
  reward_minutes: number;
  // Teams only ever receive "active" and "claimed" (RLS); admins see all.
  status: "pool" | "active" | "claimed" | "retired";
  activated_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_multiplier: number; // the "reward xN" a claim used (migration 0019)
  locked_by: string | null; // "lock challenge": only this team can complete it
};

export const CARD_TYPES = ["curse", "powerup"] as const;
export type CardTypeKind = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABELS: Record<CardTypeKind, string> = { curse: "Curse", powerup: "Power-up" };

// Automatic effects (migration 0015). Cards with no effect are carried out by the players.
//   duplicate      copy another card in your hand
//   steal          take a random card from another team (no range)
//   veto           cancel a curse on you
//   draw X pick Y  a new draw: X cards shown, keep Y (X up to 10)
//   hand +N        hand limit +N for the rest of the game (N up to 9)
// Migration 0019:
//   reward xN          next completed challenge gives N× time and N draws (Preparation)
//   curse xN           on one of your active curses: you gain N× from it (Elimination)
//   curse copy         put one of your active curses on a second team too (Elimination, in range)
//   discard X draw Y   discard X other cards, then draw Y straight into your hand
//   replace challenge  swap a board challenge for a random one from the pool (Preparation)
//   lock challenge     only your team can complete that challenge (Preparation, one at a time)
// Migration 0026:
//   range xN           a note on one curse in your hand: "range ×N" (range is honor-system, so text only)
//   range infinite     the same: "infinite range"
//   boogeyman          after taking a photo, move up to 30 minutes from a team to yours (Elimination)
export const CARD_EFFECTS_HELP =
  "duplicate, steal, veto, draw X pick Y (e.g. draw 4 pick 2), hand +N (e.g. hand +1), reward x2, curse x2, " +
  "curse copy, discard X draw Y (e.g. discard 2 draw 3), replace challenge, lock challenge, " +
  "range x2, range infinite, boogeyman";
export type CardEffect = string;

export type ParsedEffect =
  | { kind: "none" }
  | { kind: "duplicate" | "steal" | "veto" }
  | { kind: "draw"; size: number; keep: number }
  | { kind: "hand"; bonus: number }
  | { kind: "reward" | "curseBoost"; factor: number }
  | { kind: "curseCopy" | "replaceChallenge" | "lockChallenge" }
  | { kind: "discardDraw"; discard: number; draw: number }
  | { kind: "range"; note: string }
  | { kind: "boogeyman" };

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
  const times = /^(reward|curse) x([2-9])$/.exec(effect);
  if (times) return { kind: times[1] === "reward" ? "reward" : "curseBoost", factor: Number(times[2]) };
  if (effect === "curse copy") return { kind: "curseCopy" };
  if (effect === "replace challenge") return { kind: "replaceChallenge" };
  if (effect === "lock challenge") return { kind: "lockChallenge" };
  if (effect === "boogeyman") return { kind: "boogeyman" };
  if (effect === "range infinite") return { kind: "range", note: "infinite range" };
  const range = /^range x([2-9])$/.exec(effect);
  if (range) return { kind: "range", note: `range ×${range[1]}` };
  const swap = /^discard ([1-9]) draw (\d+)$/.exec(effect);
  if (swap) {
    const draw = Number(swap[2]);
    return draw >= 1 && draw <= 10 ? { kind: "discardDraw", discard: Number(swap[1]), draw } : null;
  }
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
  range_note: string | null; // "range xN" / "range infinite" on a curse in a hand (migration 0026)
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
  attacker_gain: number; // the attacker's speed shifts by -attacker_gain ("curse xN", migration 0019)
};

export type ActivityLogEntry = {
  id: number;
  created_at: string;
  team_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
  undone_at: string | null;
};

// An activity-log entry meant for one team (team_feed, migration 0020).
export type FeedEntry = Omit<ActivityLogEntry, "undone_at">;

export type ActionResult = { ok: boolean; message: string } | null;

// Each team logs in as a Supabase user whose email is derived from the team id
// and whose password is the team's secret code.
export function teamLoginEmail(teamId: string) {
  return `team-${teamId}@example.com`;
}

export const MIN_CODE_LENGTH = 6;
