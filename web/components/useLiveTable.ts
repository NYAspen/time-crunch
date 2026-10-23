"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Loads data with `load`, then reloads it whenever the given table changes
// in the database (via Supabase Realtime). Also reloads when the phone wakes up
// or reconnects, because realtime messages can be missed while asleep.
export function useLiveTable<T>(table: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const refresh = () => {
      load()
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not load data");
        });
    };

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

    refresh();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      supabase.removeChannel(channel);
    };
    // `load` is expected to be stable (defined at module level).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  return { data, error };
}
