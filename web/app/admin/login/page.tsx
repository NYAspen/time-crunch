"use client";

import Link from "next/link";
import { useActionState } from "react";
import { adminLogin } from "./actions";
import { Notice } from "@/components/Notice";
import { PageSign } from "@/components/PageSign";

export default function AdminLoginPage() {
  const [result, formAction, pending] = useActionState(adminLogin, null);

  return (
    <main className="space-y-6">
      <Link href="/" className="-my-2 inline-block py-2 pr-4 text-blue-700">
        ← Back
      </Link>
      <PageSign title="Admin login" />
      <form action={formAction} className="space-y-4">
        <label className="block space-y-1">
          <span className="tc-label">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded-lg border-2 border-gray-900 bg-white p-3"
          />
        </label>
        <label className="block space-y-1">
          <span className="tc-label">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border-2 border-gray-900 bg-white p-3"
          />
        </label>
        {result && !result.ok && <Notice result={result} />}
        <button
          disabled={pending}
          className="w-full rounded-xl bg-gray-900 p-4 text-lg font-bold text-white disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
