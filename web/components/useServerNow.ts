"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Returns the current SERVER time in ms, updated every `tickMs`.
// Phones' clocks can be minutes off, so we measure the difference to the
// database clock and correct for it. Returns null until the first tick.
export function useServerNow(tickMs = 250): number | null {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const measure = async () => {
      const sent = Date.now();
      const { data, error } = await supabase.rpc("server_now");
      const received = Date.now();
      if (!error && data) {
        setOffset(new Date(data).getTime() - (sent + received) / 2);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") measure();
    };

    measure();
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => setNow(Date.now()), tickMs);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tickMs]);

  return now === null ? null : now + offset;
}
