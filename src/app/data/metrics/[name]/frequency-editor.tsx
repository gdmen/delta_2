"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type FrequencyHint = "daily" | "weekly" | "occasional";

/**
 * Frequency hint editor on the metric detail page. Saves to
 * `/api/metric-types/:id`; metric-history's `loadType()` reads the field
 * back on every chart render, so flipping the value here re-shapes every
 * dashboard / goal / widget that uses this metric on the next page load.
 *
 * Why this exists: the ingest auto-create path
 * (`src/lib/ingest/metric-resolver.ts`) defaults every newly-seen orphan
 * to `"daily"` because that's right for high-volume importers (Apple
 * Health steps, Strava activity_minutes). Point-in-time measurements
 * (DEXA scan body comp, body weight) need to be reclassified by hand —
 * otherwise `excludeTodayIfDaily` filters out the latest reading on the
 * day it was taken, making the chart look stuck on yesterday's data.
 */
export function MetricFrequencyEditor({
  metricTypeId,
  initialFrequencyHint,
}: {
  metricTypeId: number;
  initialFrequencyHint: FrequencyHint;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [frequency, setFrequency] = useState<FrequencyHint>(initialFrequencyHint);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = frequency !== initialFrequencyHint;

  async function save() {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/metric-types/${metricTypeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frequencyHint: frequency }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `Save failed (${res.status})`);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="border border-border rounded p-4 mb-6">
      <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
        Frequency
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <label className="flex items-baseline gap-2 text-[0.875rem]">
          <span className="text-text-secondary">Cadence:</span>
          <select
            value={frequency}
            onChange={(e) => {
              setFrequency(e.target.value as FrequencyHint);
              setSaved(false);
            }}
            className="px-2 py-1 border border-border rounded font-mono text-[0.8125rem] focus:outline-none focus:border-foreground bg-background"
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="occasional">occasional</option>
          </select>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="px-3 py-1 text-[0.8125rem] border border-border rounded hover:border-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && (
          <span className="font-mono text-[0.6875rem] text-accent-green">saved</span>
        )}
        {error && <span className="font-mono text-[0.6875rem] text-accent-red">{error}</span>}
      </div>
      <p className="mt-2 text-[0.75rem] text-muted">
        <span className="font-mono">daily</span> / <span className="font-mono">weekly</span>:
        rolling aggregate (steps, sleep, activity minutes). Today&apos;s value is
        mid-flight, so charts hide it.{" "}
        <span className="font-mono">occasional</span>: point-in-time
        measurement (DEXA scan, body weight). Today&apos;s reading is the
        complete reading, so charts show it as soon as it&apos;s saved.
      </p>
    </div>
  );
}
