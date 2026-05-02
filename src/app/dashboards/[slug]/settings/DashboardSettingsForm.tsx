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
}

export function DashboardSettingsForm({ dashboard, sports }: Props) {
  const router = useRouter();
  const [name, setName] = useState(dashboard.name);
  const [slug, setSlug] = useState(dashboard.slug);
  const [sportId, setSportId] = useState<number | "">(dashboard.sportId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugLocked = dashboard.isSystem;
  const dirty =
    name !== dashboard.name ||
    slug !== dashboard.slug ||
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
      // If the slug changed, the URL we're on is now stale.
      const newSlug = json.dashboard.slug;
      const target = newSlug === "today" ? "/" : `/dashboards/${newSlug}`;
      router.push(`${target}/settings`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
