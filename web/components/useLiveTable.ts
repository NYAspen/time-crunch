"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const REFRESH_EVENT = "live-tables-refresh";

// Call after any action that changes data, so every live section on the page
// (clock, board, history…) reloads now instead of waiting for realtime,
// which can take a few seconds.
export function refreshAllLiveTables() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

// Wraps a form action (for useActionState) so live sections reload once it finishes.
export function withRefresh<S>(action: (prev: S, formData: FormData) => Promise<S>) {
  return async (prev: S, formData: FormData) => {
    const result = await action(prev, formData);
    refreshAllLiveTables();
    return result;
  };
}

// Loads data with `load`, then reloads it whenever the given table changes
// in the database (via Supabase Realtime). Also reloads when the phone wakes up
// or reconnects, because realtime messages can be missed while asleep.
// Returns `refresh` so a page can reload right after its own action instead of
// waiting for the realtime message.
export function useLiveTable<T>(table: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  // Several reloads can overlap; only the newest one may update the screen,
  // otherwise a slow, older reply could overwrite fresher data.
  const latestRequest = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    const requestId = ++latestRequest.current;
    loadRef
      .current()
      .then((result) => {
        if (mounted.current && requestId === latestRequest.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (mounted.current && requestId === latestRequest.current) {
          setError(e instanceof Error ? e.message : "Could not load data");
        }
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const supabase = createClient();

    const channel = supabase
      .channel(`live-${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, refresh)
      .subscribe((status) => {
        // Reload after (re)connecting so nothing missed while offline is lost.
        if (status === "SUBSCRIBED") refresh();
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener(REFRESH_EVENT, refresh);

    refresh();

    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener(REFRESH_EVENT, refresh);
      supabase.removeChannel(channel);
    };
  }, [table, refresh]);

  return { data, error, refresh };
}
