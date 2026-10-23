"use client";

import Link from "next/link";
import { useActionState } from "react";
import { adminLogin } from "./actions";

export default function AdminLoginPage() {
  const [result, formAction, pending] = useActionState(adminLogin, null);

  return (
    <main className="space-y-6">
      <Link href="/" className="text-blue-700">
        ← Back
      </Link>
      <h1 className="text-2xl font-bold">Admin login</h1>
      <form action={formAction} className="space-y-4">
        <label className="block space-y-1">
          <span className="font-medium">Email</span>
          <input name="email" type="email" required autoComplete="username" className="w-full rounded-lg border bg-white p-3" />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border bg-white p-3"
          />
        </label>
        {result && !result.ok && <p className="rounded-lg bg-red-100 p-3 text-red-800">{result.message}</p>}
        <button
          disabled={pending}
          className="w-full rounded-xl bg-gray-900 p-4 text-lg font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
