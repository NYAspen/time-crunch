import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { LogoutButton } from "@/components/LogoutButton";
import { PhaseBanner } from "@/components/PhaseBanner";
import { SessionGuard } from "@/components/SessionGuard";
import { isAdmin } from "@/lib/auth";
import { ActivityLog } from "./ActivityLog";
import { CardManager } from "./CardManager";
import { ChallengeManager } from "./ChallengeManager";
import { CurseList } from "./CurseList";
import { PhaseControls } from "./PhaseControls";
import { ResetGame } from "./ResetGame";
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
      <SessionGuard loginPath="/admin/login" />
      <ConnectionBanner />
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <LogoutButton />
      </header>
      <PhaseBanner />
      <PhaseControls />
      <TeamClocks />
      <CurseList />
      <ChallengeManager />
      <CardManager />
      <TeamManager />
      <ActivityLog />
      <ResetGame />
    </>
  );
}
