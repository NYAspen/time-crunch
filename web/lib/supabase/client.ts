import { createBrowserClient } from "@supabase/ssr";
import { resilientFetch } from "@/lib/connection";

// Supabase client for code running in the browser. Uses the public key only.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: resilientFetch } },
  );
}
