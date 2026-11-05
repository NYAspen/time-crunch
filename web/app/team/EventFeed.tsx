"use client";

import { useEffect, useRef } from "react";
import { drawLabel } from "@/components/ChallengeRewards";
import { showToast, type Toast } from "@/components/Toasts";
import { useLiveTable } from "@/components/useLiveTable";
import { loadTeamFeed } from "@/lib/queries";
import { formatDelta } from "@/lib/time";
import type { FeedEntry } from "@/lib/types";

// Pops down a notification for each new thing another team or the admin did
// that matters to this team (team_feed, migration 0020). The newest entry
// shown is remembered on this phone, so a reload doesn't repeat them, and
// anything that happened while the phone was locked (last 30 min) still shows.
const SEEN_KEY = "tc-feed-seen";
const MAX_AT_ONCE = 3;

function readSeen(teamId: string): number | null {
  try {
    const saved = Number(localStorage.getItem(`${SEEN_KEY}-${teamId}`));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

function saveSeen(teamId: string, id: number) {
  try {
    localStorage.setItem(`${SEEN_KEY}-${teamId}`, String(id));
  } catch {}
}

export function EventFeed({ teamId }: { teamId: string }) {
  const { data: feed } = useLiveTable("activity_log", loadTeamFeed);
  // Kept here too, in case the phone's storage is blocked (private browsing).
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!feed) return;
    const newest = feed.reduce((max, e) => Math.max(max, e.id), 0);
    const last = seen.current ?? readSeen(teamId);
    // First visit on this phone: start from now rather than replaying the past.
    // If the newest entry is older than what we saw, the game was reset (or
    // everything is over 30 min old): start again from there.
    const restart = last === null || newest < last;
    const fresh = restart ? [] : feed.filter((e) => e.id > last);
    seen.current = restart ? newest : Math.max(newest, last);
    saveSeen(teamId, seen.current);

    const toasts = fresh
      .map((e) => describe(e, teamId))
      .filter((t): t is Omit<Toast, "id"> => t !== null)
      .slice(0, MAX_AT_ONCE)
      .reverse(); // oldest first, so the newest ends up on top
    toasts.forEach(showToast);
    // A short buzz for bad news (Android only; iPhones ignore it).
    if (toasts.some((t) => t.tone === "red")) {
      try {
        navigator.vibrate?.(200);
      } catch {}
    }
  }, [feed, teamId]);

  return null;
}

function describe(e: FeedEntry, teamId: string): Omit<Toast, "id"> | null {
  const d = e.details as Record<string, string | number | undefined>;
  const mine = e.team_id === teamId;
  const team = d.name ?? "Another team";
  const admin = (message: string): Omit<Toast, "id"> => ({ tone: "orange", icon: "A", title: "Admin", message });

  switch (e.event_type) {
    case "phase_changed":
      return d.to === "elimination"
        ? {
            tone: "red",
            icon: "▶",
            title: "Elimination has started",
            message: "Countdowns are running. Curses can now be played.",
          }
        : { tone: "black", icon: "i", title: "Phase changed", message: "Back to Preparation." };
    case "team_eliminated":
      if (mine) {
        return {
          tone: "red",
          icon: "✕",
          title: "You're out",
          message:
            d.by === "admin"
              ? "The admin eliminated your team. You can still watch the game."
              : "Your time ran out. You can still watch the game.",
        };
      }
      return { tone: "black", icon: "✕", title: "Team eliminated", message: `${team} is out of the game.` };
    case "team_revived":
      return mine
        ? { tone: "green", icon: "✓", title: "You're back in", message: "The admin brought your team back." }
        : { tone: "black", icon: "i", title: "Team back in", message: `${team} is back in the game.` };
    case "challenge_claimed":
      return {
        tone: "black",
        icon: "↻",
        title: "Challenge replaced",
        message: `${team} completed "${d.challenge}". A new challenge is on the board.`,
      };
    case "card_used":
      if (!d.challenge) return null;
      return d.new_challenge
        ? {
            tone: "black",
            icon: "↻",
            title: "Challenge replaced",
            message: `${team} replaced "${d.challenge}" with "${d.new_challenge}".`,
          }
        : {
            tone: "black",
            icon: "🔒",
            title: "Challenge locked",
            message: `${team} locked "${d.challenge}". Only they can complete it now.`,
          };
    case "curse_started":
      return {
        tone: "red",
        icon: "!",
        title: "You've been cursed",
        message: `${team} cursed you with ${d.curse ?? d.card}. Your clock now runs 1× faster until you clear it.`,
      };
    case "card_stolen":
      return {
        tone: "red",
        icon: "!",
        title: "Card stolen",
        message: d.stolen_card
          ? `${team} stole ${d.stolen_card} from your hand.`
          : `${team} tried to steal from you, but your hand was empty.`,
      };
    case "curse_cleared":
      if (d.by === "admin") return admin(`The admin cleared the curse ${d.card}.`);
      return {
        tone: "black",
        icon: "i",
        title: "Curse cleared",
        message: `${team} cleared your curse ${d.card}. Your speed has shifted back.`,
      };
    case "curse_vetoed":
      return {
        tone: "red",
        icon: "!",
        title: "Curse vetoed",
        message: d.minutes
          ? `${team} paid ${d.minutes} minutes to veto your curse ${d.card}. You gain ${d.minutes} minutes.`
          : `${team} used a Veto on your curse ${d.card}.`,
      };
    case "curse_veto_undone":
      return {
        tone: "black",
        icon: "i",
        title: "Veto undone",
        message: `${team}'s veto was undone. Your curse ${d.card} is back on, and the ${d.minutes} minutes went back to them.`,
      };
    case "time_adjusted":
      return admin(
        `The admin changed your time: ${formatDelta(Number(d.seconds) * 1000)}${d.reason ? ` (${d.reason})` : ""}.`,
      );
    case "draw_granted":
      return admin(`The admin gave you a draw (${drawLabel(Number(d.size))}). Open the Cards tab.`);
    case "draw_cancelled":
      return admin("The admin cancelled one of your draws.");
    case "speed_set_by_admin":
      return admin(`The admin set your countdown speed to ${d.to}×.`);
    case "card_moved_by_admin":
      return d.to_team === teamId
        ? admin(`The admin gave you ${d.card}.`)
        : admin(`The admin took ${d.card} from your hand.`);
    case "curse_restarted":
      return admin(`The admin restarted the curse ${d.card}.`);
    case "claim_undone":
      return admin(`The admin undid your completion of "${d.challenge}".`);
    case "action_undone":
      return admin(`The admin undid: ${d.action}`);
    default:
      return null;
  }
}
