"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  hasPassword: boolean;
  hasHaeKey: boolean;
  isOwner: boolean;
  email: string;
  haeIngestUrl: string;
}

/**
 * Account-management form bundle: change password, regenerate HAE key,
 * delete account. Owner sees the same form sans delete (server also
 * refuses with 403).
 */
export function AccountForm({
  hasPassword,
  hasHaeKey,
  isOwner,
  email,
  haeIngestUrl,
}: Props) {
  return (
    <div className="space-y-8">
      <PasswordSection hasPassword={hasPassword} />
      <HaeKeySection hasHaeKey={hasHaeKey} ingestUrl={haeIngestUrl} />
      {!isOwner && <DeleteSection email={email} />}
    </div>
  );
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password",
          currentPassword,
          newPassword,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setOkMsg("Password updated. Other devices have been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border border-border rounded p-5 space-y-3">
      <header>
        <h2 className="text-[0.9375rem] font-semibold mb-1">
          {hasPassword ? "Change password" : "Set a password"}
        </h2>
        {!hasPassword && (
          <p className="text-[0.8125rem] text-text-secondary">
            You currently sign in with Google. Setting a password gives
            you a backup way to sign in.
          </p>
        )}
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        {hasPassword && (
          <div>
            <label className="block text-[0.8125rem] font-medium mb-1">
              Current password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
            />
          </div>
        )}
        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            New password
          </label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
        </div>
        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            Confirm new password
          </label>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
          />
        </div>

        {error && (
          <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
            {error}
          </div>
        )}
        {okMsg && (
          <div className="px-3 py-2 bg-accent-green/10 border border-accent-green/20 rounded text-[0.8125rem] text-accent-green">
            {okMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
        >
          {submitting ? "Updating…" : hasPassword ? "Update password" : "Set password"}
        </button>
      </form>
    </section>
  );
}

function HaeKeySection({
  hasHaeKey,
  ingestUrl,
}: {
  hasHaeKey: boolean;
  ingestUrl: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onGenerate() {
    if (
      !window.confirm(
        hasHaeKey
          ? "Replace your existing HAE key? The old key stops working immediately."
          : "Generate a new HAE key for the iOS Shortcut?",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hae-key" }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setToken(body.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border border-border rounded p-5 space-y-3">
      <header>
        <h2 className="text-[0.9375rem] font-semibold mb-1">Apple Health key</h2>
        <p className="text-[0.8125rem] text-text-secondary">
          Bearer token your iOS Shortcut sends with each Health Auto
          Export request. Stored encrypted server-side; we can&apos;t
          show the existing one — only generate a new one.
        </p>
      </header>

      <div className="text-[0.75rem] font-mono text-text-secondary">
        Endpoint: {ingestUrl}
      </div>

      {token && (
        <div className="space-y-2">
          <p className="text-[0.8125rem] font-medium">
            Copy this into your Shortcut&apos;s Authorization header now —
            you won&apos;t see it again:
          </p>
          <pre className="px-3 py-2 bg-surface border border-border rounded text-[0.75rem] font-mono overflow-x-auto break-all">
            Bearer {token}
          </pre>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(`Bearer ${token}`)}
            className="px-3 py-1 border border-border rounded text-[0.75rem] hover:bg-surface"
          >
            Copy
          </button>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={submitting}
        className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
      >
        {submitting
          ? "Generating…"
          : hasHaeKey
            ? "Regenerate key"
            : "Generate key"}
      </button>
    </section>
  );
}

function DeleteSection({ email }: { email: string }) {
  const router = useRouter();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (confirmEmail !== email) {
      setError("Type your email exactly to confirm.");
      return;
    }
    if (
      !window.confirm(
        "DELETE your account and all its data? This can't be undone.",
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/users/me", { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      // Sign out + bounce.
      await fetch("/api/auth/signout", { method: "POST" });
      router.push("/signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setSubmitting(false);
    }
  }

  return (
    <section className="border border-accent-red/40 rounded p-5 space-y-3">
      <header>
        <h2 className="text-[0.9375rem] font-semibold mb-1 text-accent-red">
          Delete account
        </h2>
        <p className="text-[0.8125rem] text-text-secondary">
          Permanently removes your account and all your data. Type your
          email below to confirm.
        </p>
      </header>

      <input
        type="email"
        placeholder={email}
        value={confirmEmail}
        onChange={(e) => setConfirmEmail(e.target.value)}
        className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
      />

      {error && (
        <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={submitting || confirmEmail !== email}
        className="px-4 py-2 border border-accent-red text-accent-red rounded text-[0.8125rem] font-medium hover:bg-accent-red/10 disabled:opacity-50"
      >
        {submitting ? "Deleting…" : "Delete account"}
      </button>
    </section>
  );
}
