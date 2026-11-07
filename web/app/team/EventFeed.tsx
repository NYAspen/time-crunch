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
// anything that happened while the phone was locked or offline still shows.
const SEEN_KEY = "tc-feed-seen";
const MAX_AT_ONCE = 3;

function readSeen(teamId: string): number | null {
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}-${teamId}`);
    const saved = Number(raw);
    return raw !== null && Number.isFinite(saved) ? saved : null;
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

    const all = fresh.map((e) => describe(e, teamId)).filter((t): t is Omit<Toast, "id"> => t !== null);
    // Back from a tunnel with too many to show: bad news first, then a pointer
    // to the rest, so nothing is silently lost.
    const toasts =
      all.length <= MAX_AT_ONCE
        ? [...all].reverse() // oldest first, so the newest ends up on top
        : [
            {
              tone: "black" as const,
              icon: "i",
              title: "While you were away",
              message: `${all.length - (MAX_AT_ONCE - 1)} more updates. See Recent events on the Teams tab.`,
            },
            ...[...all.filter((t) => t.tone === "red"), ...all.filter((t) => t.tone !== "red")]
              .slice(0, MAX_AT_ONCE - 1)
              .reverse(),
          ];
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

// The same news as a list on the Teams tab, for anything missed or closed too soon.
export function RecentEvents({ teamId }: { teamId: string }) {
  const { data: feed } = useLiveTable("activity_log", loadTeamFeed);
  const events = (feed ?? []).flatMap((e) => {
    const toast = describe(e, teamId);
    return toast ? [{ id: e.id, at: e.created_at, ...toast }] : [];
  });

  return (
    <details className="mt-6 text-sm">
      <summary className="cursor-pointer font-bold">Recent events ({events.length})</summary>
      {events.length === 0 ? (
        <p className="mt-2 text-gray-500">Nothing yet.</p>
      ) : (
        <ul className="mt-2 divide-y border bg-white">
          {events.map((e) => (
            <li key={e.id} className="p-2">
              <span className="flex justify-between gap-2">
                <b>{e.title}</b>
                <span className="shrink-0 text-xs text-gray-500">
                  {new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </span>
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
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
    case "boogeyman_undone":
      return {
        tone: "black",
        icon: "i",
        title: "Time back",
        message: `${team} undid The Boogeyman. You got your ${d.taken_minutes} minutes back.`,
      };
    case "card_used":
      if (d.taken_minutes) {
        return {
          tone: "red",
          icon: "!",
          title: "Time taken",
          message: `${team} used ${d.card} on you and took ${d.taken_minutes} minutes of your time.`,
        };
      }
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
    case "challenge_retired":
      return {
        tone: "black",
        icon: "↻",
        title: d.new_challenge ? "Challenge replaced" : "Challenge removed",
        message:
          (d.new_challenge
            ? `The admin replaced "${d.challenge}" with "${d.new_challenge}".`
            : `The admin removed "${d.challenge}" from the board.`) +
          (d.was_locked ? " The lock on it has ended." : ""),
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
