"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { slugify } from "@/lib/dashboards/slug";

interface ActivityRow {
  id: number;
  name: string;
  color: string;
}

export function NewDashboardForm({ activities }: { activities: ActivityRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [activityId, setActivityId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from name as the user types until they explicitly edit it.
  // Once they touch the slug field, we stop overwriting their value.
  const derivedSlug = slugTouched ? slug : (slugify(name) ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: derivedSlug || undefined,
          activityId: activityId === "" ? null : activityId,
        }),
      });
      const json = (await res.json()) as { dashboard?: { slug: string }; error?: string };
      if (!res.ok || !json.dashboard) {
        setError(json.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.push(`/dashboards/${json.dashboard.slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name">
        <input
          id="name"
          type="text"
          required
          maxLength={255}
          autoComplete="off"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Powerlifting"
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
        />
      </Field>

      <Field
        label="URL slug"
        htmlFor="slug"
        hint={slugHint(slugTouched, name, derivedSlug)}
      >
        <input
          id="slug"
          type="text"
          maxLength={64}
          autoComplete="off"
          value={slugTouched ? slug : derivedSlug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          placeholder="powerlifting"
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-mono focus:outline-none focus:border-foreground"
        />
      </Field>

      <Field label="Activity (optional)" htmlFor="activity">
        <select
          id="activity"
          value={activityId}
          onChange={(e) => setActivityId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground bg-background"
        >
          <option value="">— None —</option>
          {activities.map((s) => (
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

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create dashboard"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Tells the user what URL their dashboard will live at, or surfaces the
 * "your name has no usable letters/digits" failure mode (e.g. emoji-only
 * input). Generic "Type a name above" lies when the name is non-empty.
 */
function slugHint(touched: boolean, name: string, derivedSlug: string): string {
  if (touched) return "Lowercase letters, digits, dashes. 1-64 chars.";
  if (derivedSlug) return `URL will be /dashboards/${derivedSlug}`;
  if (name.trim().length === 0) return "Auto-generated from name. Type a name above.";
  return "Pick a name with letters or numbers — emoji and symbols alone won't work.";
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
