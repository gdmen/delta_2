"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DashboardRow } from "@/lib/dashboards/load";

interface SportRow {
  id: number;
  name: string;
  color: string;
}

interface Props {
  dashboard: DashboardRow;
  sports: SportRow[];
  activeShareToken: string | null;
}

export function DashboardSettingsForm({ dashboard, sports, activeShareToken }: Props) {
  const router = useRouter();
  const [name, setName] = useState(dashboard.name);
  const [slug, setSlug] = useState(dashboard.slug);
  const [sportId, setSportId] = useState<number | "">(dashboard.sportId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugLocked = dashboard.isSystem;
  // Compare trimmed values for `dirty` so a trailing space alone doesn't
  // enable Save. The server trims `name` on PATCH, so untrimmed input
  // would PATCH to the same value, the server would return success, and
  // the form would re-arm itself indefinitely against the unchanged prop.
  const dirty =
    name.trim() !== dashboard.name ||
    slug.trim() !== dashboard.slug ||
    (sportId === "" ? null : sportId) !== dashboard.sportId;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !dirty) return;
    setError(null);
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (name !== dashboard.name) patch.name = name.trim();
      if (slug !== dashboard.slug) patch.slug = slug;
      if ((sportId === "" ? null : sportId) !== dashboard.sportId) {
        patch.sportId = sportId === "" ? null : sportId;
      }
      const res = await fetch(`/api/dashboards/${dashboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as { dashboard?: DashboardRow; error?: string };
      if (!res.ok || !json.dashboard) {
        setError(json.error ?? `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      // Sync local state from the saved row. The server may have
      // normalized values (trimming `name`); without this resync the
      // local state holds the un-normalized input and `dirty` stays
      // true on the same content, re-enabling Save against a no-op.
      setName(json.dashboard.name);
      setSlug(json.dashboard.slug);
      setSportId(json.dashboard.sportId ?? "");
      // If the slug changed, the URL we're on is now stale; navigate
      // there. Otherwise router.refresh re-runs the server component
      // so the next dirty-check sees the updated dashboard prop.
      const newSlug = json.dashboard.slug;
      if (newSlug !== dashboard.slug) {
        router.push(`/dashboards/${newSlug}/settings`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Always release the save lock — the success branch above used
      // to forget this and the button got stuck on "Saving…" until
      // the user reloaded.
      setSaving(false);
    }
  }

  async function onDelete() {
    if (deleting) return;
    if (
      !window.confirm(
        `Delete "${dashboard.name}"? This will remove the dashboard and all its widgets. This can't be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboard.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `HTTP ${res.status}`);
        setDeleting(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <ShareLinkSection
        dashboardId={dashboard.id}
        initialToken={activeShareToken}
      />
      <form onSubmit={onSave} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name">
        <input
          id="name"
          type="text"
          required
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
        />
      </Field>

      <Field
        label="URL slug"
        htmlFor="slug"
        hint={
          slugLocked
            ? "System dashboards keep their URL slug fixed."
            : "Lowercase letters, digits, dashes. Changing this updates the URL."
        }
      >
        <input
          id="slug"
          type="text"
          maxLength={64}
          value={slug}
          disabled={slugLocked}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-mono focus:outline-none focus:border-foreground disabled:bg-surface disabled:text-muted"
        />
      </Field>

      <Field label="Sport (optional)" htmlFor="sport">
        <select
          id="sport"
          value={sportId}
          onChange={(e) => setSportId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground bg-background"
        >
          <option value="">— None —</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      {error && (
        <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-border mt-2 -mx-1 px-1">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!dashboard.isSystem && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="ml-auto px-4 py-2 border border-accent-red/40 text-accent-red rounded text-[0.8125rem] font-medium hover:bg-accent-red/10 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete dashboard"}
          </button>
        )}
      </div>
      </form>
    </div>
  );
}

function ShareLinkSection({
  dashboardId,
  initialToken,
}: {
  dashboardId: number;
  initialToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/share/${token}`
      : token
        ? `/share/${token}`
        : null;

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
        method: "POST",
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !json.token) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setToken(json.token);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy || !token) return;
    if (!window.confirm("Revoke this share link? Anyone holding it will get a 404 immediately.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setToken(null);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Reset the "Copied!" affordance after a couple seconds so the
      // button is ready for the next click.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the URL so the user can ⌘C themselves.
      const input = document.getElementById(`share-url-${dashboardId}`) as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-[0.875rem] font-semibold">Share link</h2>
        <p className="text-[0.75rem] text-muted mt-0.5">
          Read-only public URL. Anyone with the link can view this dashboard;
          revoke any time. One active link per dashboard — re-minting replaces
          the previous one.
        </p>
      </header>

      {token && url ? (
        <div className="flex flex-col gap-2">
          <input
            id={`share-url-${dashboardId}`}
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full px-3 py-2 border border-border rounded text-[0.8125rem] font-mono bg-surface focus:outline-none focus:border-foreground"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className="px-3 py-1.5 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={mint}
              disabled={busy}
              className="px-3 py-1.5 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface disabled:opacity-50"
              title="Mint a fresh link; the old one stops working immediately."
            >
              {busy ? "Working…" : "Regenerate"}
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="ml-auto px-3 py-1.5 border border-accent-red/40 text-accent-red rounded text-[0.8125rem] font-medium hover:bg-accent-red/10 disabled:opacity-50"
            >
              {busy ? "Working…" : "Revoke"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={mint}
            disabled={busy}
            className="px-3 py-1.5 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create share link"}
          </button>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[0.8125rem] font-medium mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[0.75rem] text-muted">{hint}</p>}
    </div>
  );
}
