"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    setError(res ? "That password did not work. Check it and try again." : "Could not reach the server. Check the connection and try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="pw" className="label">
          Password
        </label>
        <div className="flex gap-2">
          <input
            id="pw"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "pw-err" : undefined}
            autoFocus
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} className="btn-ghost shrink-0 !px-4">
            {show ? "Hide" : "Show"}
            <span className="sr-only"> password</span>
          </button>
        </div>
        {error && (
          <p id="pw-err" role="alert" className="mt-1.5 text-sm font-medium text-alert">
            {error}
          </p>
        )}
      </div>
      <button className="btn-primary w-full" disabled={busy || !password} aria-busy={busy || undefined}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
