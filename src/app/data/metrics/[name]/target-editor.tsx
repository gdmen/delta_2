"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Target + direction editor on the metric detail page. Saves to
 * `/api/metric-types/:id`; the values flow into every widget on every
 * dashboard via metric-history's loadType() — no per-widget config to
 * keep in sync.
 *
 * "Higher is better" controls how the dashboard color codes the
 * headline number: on = floor (sleep target = at least 8h, green when
 * you hit it); off = ceiling (body fat % target = at most 15%, green
 * when you're under).
 */
export function MetricTargetEditor({
  metricTypeId,
  unit,
  initialTarget,
  initialHigherIsBetter,
}: {
  metricTypeId: number;
  unit: string;
  initialTarget: number | null;
  initialHigherIsBetter: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string>(initialTarget == null ? "" : String(initialTarget));
  const [higherIsBetter, setHigherIsBetter] = useState(initialHigherIsBetter);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    (target.trim() === "" ? null : Number(target)) !== initialTarget ||
    higherIsBetter !== initialHigherIsBetter;

  async function save() {
    setError(null);
    setSaved(false);
    const trimmed = target.trim();
    let parsed: number | null;
    if (trimmed === "") {
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        setError("Target must be a number, or empty.");
        return;
      }
      parsed = n;
    }
    const res = await fetch(`/api/metric-types/${metricTypeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: parsed, higherIsBetter }),
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
        Target
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <label className="flex items-baseline gap-2 text-[0.875rem]">
          <span className="text-text-secondary">Value:</span>
          <input
            type="text"
            inputMode="decimal"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setSaved(false);
            }}
            placeholder="(none)"
            className="w-24 px-2 py-1 border border-border rounded font-mono text-[0.8125rem] focus:outline-none focus:border-foreground bg-background"
          />
          {unit && <span className="font-mono text-[0.8125rem] text-muted">{unit}</span>}
        </label>
        <label className="flex items-center gap-2 text-[0.875rem]">
          <input
            type="checkbox"
            checked={higherIsBetter}
            onChange={(e) => {
              setHigherIsBetter(e.target.checked);
              setSaved(false);
            }}
          />
          <span className="text-text-secondary">Higher is better</span>
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
        Empty = no target. Higher is better → target is a floor (sleep,
        protein). Off → target is a ceiling (body fat %, weight).
      </p>
    </div>
  );
}
