"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// If this phone's login ends mid-game, go to the login page. Otherwise the
// privacy rules just return nothing and the game looks empty.
export function SessionGuard({ loginPath }: { loginPath: string }) {
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.href = loginPath;
    });
    return () => data.subscription.unsubscribe();
  }, [loginPath]);
  return null;
}
