"use client";

import { useState } from "react";

interface LastReconcile {
  at: string;
  totalDeleted: number;
  perType: { metricName: string | null; kind: "metric" | "event"; deleted: number }[];
}

/**
 * Client toggle for the per-source reconcile setting. Wraps a checkbox +
 * the explainer block. PATCHes /api/source-settings/:source on change.
 */
export function ReconcileToggle({
  source,
  initialEnabled,
  lastReconcile,
  csvLine,
}: {
  source: string;
  initialEnabled: boolean;
  lastReconcile: LastReconcile | null;
  /** Extra one-liner shown for custom CSV sources at the bottom. */
  csvLine?: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    const previous = enabled;
    setEnabled(next);
    try {
      const res = await fetch(`/api/source-settings/${encodeURIComponent(source)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconcileEnabled: next }),
      });
      if (!res.ok) {
        setEnabled(previous);
        setError(((await res.json()).error as string) ?? "Failed to update");
      }
    } catch (err) {
      setEnabled(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-[0.875rem] font-semibold">
            Mirror deletions from the third-party app
          </span>
        </label>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          aria-label="How this works"
          title="How this works"
          className="w-5 h-5 rounded-full border border-border text-muted hover:text-foreground hover:border-foreground text-[0.6875rem] font-semibold flex items-center justify-center leading-none"
        >
          ?
        </button>
      </div>

      {showHelp && (
        <div className="text-[0.8125rem] text-text-secondary leading-[1.6] max-w-[640px] space-y-2 border-l-2 border-border pl-3">
          <p>
            When the third-party app sends data to Delta, Delta normally just adds new entries and updates any
            that changed. If you delete something in the third-party app — say, you fix a bad water entry —
            Delta won&apos;t know. The old row sticks around.
          </p>
          <p>
            Turn this on and Delta will remove entries that weren&apos;t in the most recent update. Only the
            dates and types of data in that update are affected: a morning sync of heart rate won&apos;t touch
            your sleep history.
          </p>
          {csvLine && <p>{csvLine}</p>}
        </div>
      )}

      <div className="text-[0.8125rem] text-text-secondary leading-[1.6] max-w-[640px]">
        <p>
          <span className="font-semibold">Off (default, safer):</span> Delta never deletes anything on its own.
          <br />
          <span className="font-semibold">On:</span> Delta trims anything the third-party app no longer has.
        </p>
      </div>

      <LastReconcileChip last={lastReconcile} />

      {error && (
        <div className="p-2 text-[0.75rem] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded">
          {error}
        </div>
      )}
    </div>
  );
}

function LastReconcileChip({ last }: { last: LastReconcile | null }) {
  if (!last) return null;

  return (
    <div className="font-mono text-[0.6875rem] text-text-secondary space-y-0.5">
      <div>
        Last reconcile: {last.totalDeleted} deletion{last.totalDeleted === 1 ? "" : "s"} ·{" "}
        {formatAt(last.at)}
      </div>
      {last.perType.length > 0 && (
        <ul className="ml-4 text-muted space-y-0.5">
          {last.perType.map((p, i) => (
            <li key={i}>
              {p.metricName ?? "events"} · {p.deleted} deletion{p.deleted === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAt(iso: string): string {
  // SQLite emits "YYYY-MM-DD HH:MM:SS"; new Date() handles either form.
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} at ${hh}:${mi}`;
}
