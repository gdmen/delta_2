"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

interface Props {
  callbackUrl: string;
  error?: string;
}

/**
 * Sign-in form. Two paths:
 *   - "Continue with Google" → next-auth/react's signIn("google", ...).
 *     OAuth round-trip handles everything; we just hand off the
 *     callbackUrl so post-callback we land on the page the user
 *     originally tried to visit.
 *   - Email + password → signIn("credentials"). next-auth/react
 *     POSTs to /api/auth/callback/credentials and either sets the
 *     JWT cookie or returns an error.
 *
 * Generic error message ("invalid credentials") regardless of which
 * leg failed — no user-enumeration leak (per the eng-review HIGH
 * finding on the explicit-guard pattern).
 */
export function SignInForm({ callbackUrl, error: initialError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? "Invalid email or password" : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function onCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        callbackUrl,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Invalid email or password");
        setSubmitting(false);
        return;
      }
      // Successful sign-in — navigate to callback.
      window.location.href = res.url ?? callbackUrl;
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  function onGoogle() {
    void signIn("google", { callbackUrl });
  }

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">Sign in to Delta</h1>
      </header>

      <button
        type="button"
        onClick={onGoogle}
        disabled={submitting}
        className="w-full px-4 py-3 border border-border rounded text-[0.875rem] font-medium hover:bg-surface disabled:opacity-50"
      >
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-[0.75rem] text-muted">
        <div className="flex-1 border-t border-border" />
        <span className="uppercase tracking-wider">or</span>
        <div className="flex-1 border-t border-border" />
      </div>

      <form onSubmit={onCredentialsSubmit} className="space-y-3">
        <div>
          <label htmlFor="email" className="block text-[0.8125rem] font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-[0.8125rem] font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
        </div>

        {error && (
          <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-3 bg-foreground text-background rounded text-[0.875rem] font-medium disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-[0.75rem] text-muted">
        Don&apos;t have an account? You need an{" "}
        <Link href="/signup" className="text-foreground underline">
          invite link
        </Link>
        .
      </p>
    </div>
  );
}
