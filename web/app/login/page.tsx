import Link from "next/link";
import { TeamLoginForm } from "./TeamLoginForm";

export default function LoginPage() {
  return (
    <main className="space-y-6">
      <Link href="/" className="text-blue-700">
        ← Back
      </Link>
      <h1 className="text-2xl font-bold">Team login</h1>
      <TeamLoginForm />
    </main>
  );
}
