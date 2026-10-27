import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PhaseTag } from "@/components/PhaseBanner";
import { getCurrentTeam } from "@/lib/auth";
import { logout } from "../actions";
import { CurseBanner } from "./CurseBanner";
import { TeamClockPanel } from "./TeamClockPanel";
import { TeamTabs } from "./TeamTabs";
import { UndoBar } from "./UndoBar";

export default function TeamPage() {
  return (
    <main className="space-y-6">
      <Suspense fallback={<p className="text-gray-500">Loading your team…</p>}>
        <TeamView />
      </Suspense>
    </main>
  );
}

async function TeamView() {
  // Supabase's login check reads the clock, so only run it at request time.
  await connection();
  const team = await getCurrentTeam();
  if (!team) redirect("/login");

  return (
    <>
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{team.name}</h1>
          <PhaseTag />
        </div>
        <form action={logout}>
          <button className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700">Log out</button>
        </form>
      </header>
      <TeamClockPanel teamId={team.id} />
      <CurseBanner teamId={team.id} />
      <TeamTabs teamId={team.id} />
      {/* Last, so its spacer sits at the bottom of the page, under the tabs. */}
      <UndoBar teamId={team.id} />
    </>
  );
}
