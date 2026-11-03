import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoutButton } from "@/components/LogoutButton";
import { PausedBox, PhaseTag } from "@/components/PhaseBanner";
import { getCurrentTeam } from "@/lib/auth";
import { CurseBanner } from "./CurseBanner";
import { StealAlert } from "./StealAlert";
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
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-3xl font-bold break-words">{team.name}</h1>
          <LogoutButton />
        </div>
        <PhaseTag />
      </header>
      <PausedBox />
      <TeamClockPanel teamId={team.id} />
      <CurseBanner teamId={team.id} />
      <StealAlert teamId={team.id} />
      <TeamTabs teamId={team.id} />
      {/* Last, so its spacer sits at the bottom of the page, under the tabs. */}
      <UndoBar teamId={team.id} />
    </>
  );
}
