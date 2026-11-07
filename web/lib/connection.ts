"use client";

import { useSyncExternalStore } from "react";

// Everything the browser sends to Supabase goes through resilientFetch (see
// lib/supabase/client.ts). It gives every request a time limit, retries the
// rare database conflict, and keeps track of whether this phone has a connection,
// so the screen can say when what it shows may be out of date.

const TIMEOUT_MS = 10000;
const PING_EVERY_MS = 5000;
const CONFLICT_RETRIES = 2;
// Deadlock and serialization failure: the database undid the whole action, so
// sending it again can't apply it twice.
const CONFLICT_CODES = ["40P01", "40001"];

// Sent on window once the connection is back: live data reloads, the clock re-measures.
export const RECONNECTED_EVENT = "tc-reconnected";

const NO_CONNECTION =
  "No connection. Check your signal, then see whether it went through before trying again.";
const STILL_CONFLICTING = "Several teams acted at the same moment and this one didn't go through. Tap it again.";

let offline = false;
let pingTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function setOffline(next: boolean) {
  if (next === offline) return;
  offline = next;
  listeners.forEach((l) => l());
  if (next) {
    pingTimer = setInterval(ping, PING_EVERY_MS);
  } else {
    clearInterval(pingTimer);
    window.dispatchEvent(new Event(RECONNECTED_EVENT));
  }
}

// Any reply at all, even an error, means the phone can reach the server.
function ping() {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`;
  const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" };
  resilientFetch(url, { headers, cache: "no-store" }).catch(() => {});
}

function listenToBrowser() {
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("online", ping);
}
if (typeof window !== "undefined") listenToBrowser();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// True while this phone can't reach the server.
export function useOffline() {
  return useSyncExternalStore(subscribe, () => offline, () => false);
}

// fetch with a time limit that still honours the caller's own cancel signal.
async function fetchWithLimit(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const cancel = () => controller.abort();
  init?.signal?.addEventListener("abort", cancel);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", cancel);
  }
}

function errorReply(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchWithLimit(input, init);
    } catch (e) {
      if (init?.signal?.aborted) throw e; // the caller cancelled it: not a connection problem
      setOffline(true);
      // The login code must see a real network failure: it treats that as "try
      // again later", but might treat an error reply as a dead login and sign out.
      if (String(input).includes("/auth/v1/")) throw e;
      // 599 is not a status the Supabase client retries, so this reaches the screen.
      return errorReply(NO_CONNECTION, 599);
    }
    setOffline(false);

    if (response.status < 500) return response;
    const body = await response.clone().json().catch(() => null);
    if (!CONFLICT_CODES.includes(body?.code)) return response;
    if (attempt >= CONFLICT_RETRIES) return errorReply(STILL_CONFLICTING, response.status);
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 350));
  }
}
