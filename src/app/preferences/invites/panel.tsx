"use client";

import { useState } from "react";

interface InviteRow {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedByUserId: number | null;
  usedByDisplayName: string | null;
}

interface Props {
  initial: InviteRow[];
  signupOrigin: string;
}

export function InvitesPanel({ initial, signupOrigin }: Props) {
  const [rows, setRows] = useState<InviteRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh(): Promise<void> {
    const res = await fetch("/api/invites");
    if (!res.ok) return;
    const body = (await res.json()) as { invites: InviteRow[] };
    setRows(body.invites);
  }

  async function onMint() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", { method: "POST" });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(code: string) {
    if (!window.confirm(`Revoke invite ${code}?`)) return;
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  function copyLink(code: string) {
    const url = `${signupOrigin}/signup?code=${code}`;
    void navigator.clipboard.writeText(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMint}
          disabled={submitting}
          className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
        >
          {submitting ? "Generating…" : "Generate invite code"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}

      <table className="w-full text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border text-left text-[0.6875rem] uppercase tracking-wider text-muted">
            <th className="py-2">Code</th>
            <th className="py-2">Created</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="py-4 text-muted" colSpan={4}>
                No invites yet. Generate one above.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-border/40">
              <td className="py-2 font-mono">{r.code}</td>
              <td className="py-2 text-text-secondary">
                {r.createdAt.slice(0, 10)}
              </td>
              <td className="py-2">
                {r.usedAt ? (
                  <span className="text-accent-green">
                    claimed{r.usedByDisplayName ? ` by ${r.usedByDisplayName}` : ""}
                  </span>
                ) : r.expiresAt && r.expiresAt < new Date().toISOString() ? (
                  <span className="text-muted">expired</span>
                ) : (
                  <span>active</span>
                )}
              </td>
              <td className="py-2 text-right">
                {!r.usedAt && (
                  <span className="space-x-2">
                    <button
                      type="button"
                      onClick={() => copyLink(r.code)}
                      className="px-2 py-1 border border-border rounded text-[0.75rem] hover:bg-surface"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevoke(r.code)}
                      className="px-2 py-1 border border-accent-red/40 text-accent-red rounded text-[0.75rem] hover:bg-accent-red/10"
                    >
                      Revoke
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
