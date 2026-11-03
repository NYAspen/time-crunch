import Link from "next/link";
import { PageSign } from "@/components/PageSign";

export default function Home() {
  return (
    <main className="space-y-6">
      <PageSign title="Time Crunch" large />
      <div className="space-y-3">
        <Link
          href="/login"
          className="flex items-center justify-between bg-blue-600 p-4 text-lg font-bold text-white"
        >
          Team login <span aria-hidden>→</span>
        </Link>
        <Link
          href="/admin/login"
          className="flex items-center justify-between border-2 border-gray-900 bg-white p-4 font-bold text-gray-900"
        >
          Admin <span aria-hidden>→</span>
        </Link>
      </div>
    </main>
  );
}
