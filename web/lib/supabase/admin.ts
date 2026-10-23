import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase client with the SECRET key. Bypasses RLS, so only use it in server
// actions AFTER checking the caller is allowed to do the action.
// "server-only" makes the build fail if this file is ever imported by browser code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
