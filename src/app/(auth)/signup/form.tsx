"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

interface Props {
  code: string;
  ownerName: string;
}

/**
 * Sign-up form. Two paths, both invite-code-gated:
 *
 *   - Email + password → POST /api/auth/signup (custom route: claims
 *     the invite code atomically, creates the user). Then immediately
 *     signIn("credentials") to issue the JWT cookie.
 *   - Continue with Google → TODO: stash code in __Host-signup-invite
 *     cookie and call signIn("google"). Phase 5 will wire the
 *     callback-side invite claim. For now, the Google button is
 *     hidden if the code path is ungated (skip-button-show until
 *     Phase 5 lands its end of the flow).
 */
export function SignUpForm({ code, ownerName }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Claim invite + create user.
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          email: email.trim().toLowerCase(),
          password,
          displayName: displayName.trim(),
        }),
      });
      const signupBody = (await signupRes.json()) as { ok?: boolean; error?: string };
      if (!signupRes.ok || !signupBody.ok) {
        setError(signupBody.error ?? `HTTP ${signupRes.status}`);
        setSubmitting(false);
        return;
      }

      // 2. Sign in immediately so the JWT cookie is issued.
      const signinRes = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: "/",
      });
      if (!signinRes || signinRes.error) {
        // The user exists now but the auto-sign-in failed (rare:
        // probably a race with rate-limit). Bounce them to /signin
        // so they can try the cookie issuance there.
        window.location.href = "/signin";
        return;
      }
      window.location.href = signinRes.url ?? "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">Welcome to Delta</h1>
        <p className="text-[0.8125rem] text-muted">
          Delta is {ownerName}&apos;s fitness tracker — you&apos;ve been invited.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="displayName" className="block text-[0.8125rem] font-medium mb-1">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            required
            maxLength={64}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
        </div>
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
            minLength={8}
            maxLength={256}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
          <p className="mt-1 text-[0.6875rem] text-muted">
            8 characters or more.
          </p>
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
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-[0.75rem] text-muted">
        Already have an account?{" "}
        <Link href="/signin" className="text-foreground underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
