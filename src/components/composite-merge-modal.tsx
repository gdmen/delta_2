"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface MergeMember {
  id: number;
  source: string;
  sportId: number;
  sportName: string;
  type: string;
  startedAt: string;
  durationMinutes: number | null;
}

export interface SportOption {
  id: number;
  name: string;
}

/**
 * Inline modal for "Merge these two events into a composite". Asks the
 * user for the composite's sport (free pick from any of their sports;
 * defaults to whichever member has the less source-prefixed sport
 * name — that's usually the user-curated canonical one).
 *
 * Sends POST /api/events/merge on confirm and refreshes the page.
 */
export function CompositeMergeModal({
  a,
  b,
  sportOptions,
  onClose,
}: {
  a: MergeMember;
  b: MergeMember;
  sportOptions: SportOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const defaultSport = pickDefaultSport(a, b);
  const [sportId, setSportId] = useState<number>(defaultSport);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    const res = await fetch("/api/events/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aId: a.id,
        bId: b.id,
        sportId,
        notes: notes.trim() || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg max-w-lg w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[1rem] font-semibold">Merge into composite event</h2>

        <div className="space-y-2 text-[0.8125rem]">
          <MemberRow m={a} />
          <MemberRow m={b} />
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Composite sport
          </label>
          <select
            value={sportId}
            onChange={(e) => setSportId(Number(e.target.value))}
            disabled={submitting}
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
          >
            {sportOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Notes <span className="normal-case text-muted">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background resize-none"
          />
        </div>

        {err && (
          <div className="text-[0.8125rem] text-accent-red">{err}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-[0.8125rem] bg-foreground text-background rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: MergeMember }) {
  const time = m.startedAt.slice(0, 16).replace("T", " ");
  return (
    <div className="border border-border rounded px-3 py-2 flex justify-between gap-3 font-mono text-[0.75rem]">
      <span className="text-muted uppercase tracking-wider truncate">
        {m.source}
      </span>
      <span className="truncate">
        {m.sportName} · {m.type}
      </span>
      <span className="text-muted whitespace-nowrap">
        {time}
        {m.durationMinutes ? ` · ${m.durationMinutes}m` : ""}
      </span>
    </div>
  );
}

function pickDefaultSport(a: MergeMember, b: MergeMember): number {
  // Prefer the sport name that doesn't look like `<source>:<x>` —
  // that's almost always the user-curated canonical (e.g. prefer
  // "powerlifting" over "strava:WeightTraining"). If both or neither
  // are prefixed, pick a's.
  const aIsPrefixed = a.sportName.includes(":");
  const bIsPrefixed = b.sportName.includes(":");
  if (aIsPrefixed && !bIsPrefixed) return b.sportId;
  if (!aIsPrefixed && bIsPrefixed) return a.sportId;
  return a.sportId;
}
