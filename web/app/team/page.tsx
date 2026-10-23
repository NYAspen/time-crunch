import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PhaseBanner } from "@/components/PhaseBanner";
import { TeamList } from "@/components/TeamList";
import { getCurrentTeam } from "@/lib/auth";
import { logout } from "../actions";
import { TeamClockPanel } from "./TeamClockPanel";

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
        <div>
          <div className="text-sm text-gray-500">Playing as</div>
          <h1 className="text-2xl font-bold">{team.name}</h1>
        </div>
        <form action={logout}>
          <button className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700">Log out</button>
        </form>
      </header>
      <PhaseBanner />
      <TeamClockPanel teamId={team.id} />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Teams</h2>
        <TeamList highlightTeamId={team.id} />
      </section>
    </>
  );
}
