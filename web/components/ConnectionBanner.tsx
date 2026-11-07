"use client";

import { useOffline } from "@/lib/connection";
import { SignBox } from "./SignBox";

// Stays in view while the phone has no connection, because the countdown keeps
// ticking at the last speed it heard about and looks live.
export function ConnectionBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div role="status" className="sticky top-0 z-20">
      <SignBox tone="yellow" compact title="Reconnecting…">
        <p>No connection. Your time and everything else here may be out of date until it comes back.</p>
      </SignBox>
    </div>
  );
}
