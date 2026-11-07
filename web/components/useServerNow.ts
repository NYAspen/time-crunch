"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { RECONNECTED_EVENT } from "@/lib/connection";
import { createClient } from "@/lib/supabase/client";

// Phones' clocks can be minutes off, so we measure the difference to the
// database clock and correct for it. One measurement is shared by the whole
// page. The quickest of a few tries is the most accurate: a slow reply on a phone
// network says little about when the server actually answered.
const TRIES = 3;
const RETRY_MS = 3000;
const MEASURE_EVERY_MS = 5 * 60 * 1000;

let offset: number | null = null;
let bestRoundTrip = Infinity;
let measuring = false;
let started = false;
const listeners = new Set<() => void>();

async function measure() {
  if (measuring) return;
  measuring = true;
  const supabase = createClient();
  let roundTrip = Infinity;
  let measured: number | null = null;
  for (let i = 0; i < TRIES; i++) {
    const sent = Date.now();
    const { data, error } = await supabase.rpc("server_now");
    const received = Date.now();
    if (!error && data && received - sent < roundTrip) {
      roundTrip = received - sent;
      measured = new Date(data).getTime() - (sent + received) / 2;
    }
  }
  measuring = false;

  if (measured === null) {
    if (offset === null) setTimeout(measure, RETRY_MS);
    return;
  }
  // A much slower reply than usual is less accurate than what we already have.
  if (offset !== null && roundTrip > Math.max(bestRoundTrip * 2, 500)) return;
  bestRoundTrip = Math.min(bestRoundTrip, roundTrip);
  offset = measured;
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  measure();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") measure();
  });
  window.addEventListener(RECONNECTED_EVENT, measure);
  setInterval(measure, MEASURE_EVERY_MS);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Returns the current SERVER time in ms, updated every `tickMs`. Returns null
// until the clock has been measured, so a wrong phone clock never shows.
export function useServerNow(tickMs = 250): number | null {
  const measuredOffset = useSyncExternalStore(subscribe, () => offset, () => null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return now === null || measuredOffset === null ? null : now + measuredOffset;
}
