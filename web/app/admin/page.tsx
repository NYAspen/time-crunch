import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PhaseBanner } from "@/components/PhaseBanner";
import { isAdmin } from "@/lib/auth";
import { logout } from "../actions";
import { ActivityLog } from "./ActivityLog";
import { PhaseControls } from "./PhaseControls";
import { TeamClocks } from "./TeamClocks";
import { TeamManager } from "./TeamManager";

export default function AdminPage() {
  return (
    <main className="space-y-6">
      <Suspense fallback={<p className="text-gray-500">Checking admin access…</p>}>
        <AdminView />
      </Suspense>
    </main>
  );
}

async function AdminView() {
  // Supabase's login check reads the clock, so only run it at request time.
  await connection();
  if (!(await isAdmin())) redirect("/admin/login");

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <form action={logout}>
          <button className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700">Log out</button>
        </form>
      </header>
      <PhaseBanner />
      <PhaseControls />
      <TeamClocks />
      <TeamManager />
      <ActivityLog />
    </>
  );
}
