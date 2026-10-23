"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// While a countdown on screen shows zero, keep asking the server to check for
// eliminations (every 2 s) until the team's status changes. The server decides
// using its own clock, so a phone clock that runs slightly fast just retries
// until the server agrees; it can't eliminate anyone early.
export function useEliminationCheck(shouldCheck: boolean) {
  useEffect(() => {
    if (!shouldCheck) return;
    const supabase = createClient();

    const check = async () => {
      // Supabase only sends the request when it is awaited.
      const { error } = await supabase.rpc("sweep_eliminations");
      if (error) console.error("Elimination check failed:", error.message);
    };

    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [shouldCheck]);
}
