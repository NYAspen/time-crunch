import Link from "next/link";
import { TeamLoginForm } from "./TeamLoginForm";
import { PageSign } from "@/components/PageSign";

export default function LoginPage() {
  return (
    <main className="space-y-6">
      <Link href="/" className="-my-2 inline-block py-2 pr-4 text-blue-700">
        ← Back
      </Link>
      <PageSign title="Team login" />
      <TeamLoginForm />
    </main>
  );
}
