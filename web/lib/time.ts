import type { TeamClock } from "@/lib/types";

// Same formula the database uses (see migration 0004). Only the clock row is
// used, so the result is always consistent. The server is the source of truth;
// this just lets the screen tick smoothly between updates.
export function remainingMs(clock: TeamClock, serverNowMs: number) {
  if (!clock.running) return Math.max(clock.balance_ms, 0);
  const elapsed = serverNowMs - new Date(clock.anchor_at).getTime();
  return Math.max(clock.balance_ms - clock.speed * elapsed, 0);
}

// Each curse on a team adds 1×; each curse it has played subtracts 1×.
export function curseSpeed(teamId: string, activeCurses: { target_team: string; attacker_team: string }[]) {
  const on = activeCurses.filter((c) => c.target_team === teamId).length;
  const by = activeCurses.filter((c) => c.attacker_team === teamId).length;
  return 1 + on - by;
}

export function describeSpeed(speed: number) {
  if (speed < 0) return `${speed}× — your clock goes up (you are cursing several teams)`;
  if (speed === 0) return "0× — clock stopped";
  if (speed === 1) return "1× — normal";
  return `${speed}× — your clock drains ${speed}× as fast`;
}

// 3725000 -> "1:02:05"
export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 900000 -> "+15 min", -90000 -> "−1 min 30 s"
export function formatDelta(ms: number) {
  const sign = ms < 0 ? "−" : "+";
  const total = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${sign}${m} min${s ? ` ${s} s` : ""}`;
}
