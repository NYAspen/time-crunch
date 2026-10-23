import Link from "next/link";
import { PhaseBanner } from "@/components/PhaseBanner";

export default function Home() {
  return (
    <main className="space-y-6">
      <h1 className="text-center text-2xl font-bold">
        Jet Lag: Chicago
        <br />
        <span className="text-blue-700">Time Crunch</span>
      </h1>
      <PhaseBanner />
      <div className="space-y-3">
        <Link
          href="/login"
          className="block rounded-xl bg-blue-600 p-4 text-center text-lg font-semibold text-white"
        >
          Team login
        </Link>
        <Link
          href="/admin/login"
          className="block rounded-xl border border-gray-300 bg-white p-4 text-center text-gray-700"
        >
          Admin
        </Link>
      </div>
    </main>
  );
}
