"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Schedule-this-metric editor on the metric detail page. Saves to
 * `PATCH /api/metric-types/:id` alongside the existing target +
 * frequency editors. When `autoLogDose` is non-null, the lazy
 * materializer in `src/lib/scheduled-doses.ts` stamps one metrics
 * row per local-calendar day with `value = autoLogDose`,
 * `source = 'scheduled'`. Issue #30.
 *
 * The "Started taking on" date triggers a one-shot backfill if it's
 * earlier than today — the same idempotent insert the daily
 * materializer uses, run once per day in the range. Deleting an
 * auto-logged row from the history below records a skip so that day
 * doesn't get re-created.
 */
export function AutoLogEditor({
  metricTypeId,
  unit,
  initialDose,
  initialSince,
  defaultDose,
}: {
  metricTypeId: number;
  unit: string;
  /** Current value of `metric_types.auto_log_dose`. null = not scheduled. */
  initialDose: number | null;
  /**
   * Earliest local-calendar date on which a scheduled row exists for
   * this metric (i.e. `MIN(recorded_at::date) WHERE source='scheduled'`).
   * Computed server-side; shown as the "since" date in the active state.
   * null = no scheduled rows yet (fresh schedule, or never scheduled).
   */
  initialSince: string | null;
  /**
   * Pre-fill value for the dose input when the user enables scheduling.
   * Sourced from `target` if set, else blank.
   */
  defaultDose: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Form state. `dose` is the input value; `since` is the start-date
  // picker (default = today). Used only when toggling auto-log ON.
  const [dose, setDose] = useState<string>(
    initialDose != null ? String(initialDose) : defaultDose != null ? String(defaultDose) : "",
  );
  const today = todayLocalIso();
  const [since, setSince] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const enabled = initialDose != null;

  async function save() {
    setError(null);
    setSavedMsg(null);
    const n = Number(dose);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Dose must be a number greater than 0.");
      return;
    }
    const body: Record<string, unknown> = { autoLogDose: n };
    if (since !== today) {
      body.autoLogSince = since;
    }
    const res = await fetch(`/api/metric-types/${metricTypeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `Save failed (${res.status})`);
      return;
    }
    const j = await res.json().catch(() => ({}));
    if (j.backfilled?.inserted > 0) {
      setSavedMsg(
        `Backfilled ${j.backfilled.inserted} dose${j.backfilled.inserted === 1 ? "" : "s"} from ${since}.`,
      );
    } else {
      setSavedMsg("Saved.");
    }
    startTransition(() => router.refresh());
  }

  async function stop() {
    setError(null);
    setSavedMsg(null);
    if (!confirm("Stop auto-logging? Past rows will be preserved; no new rows will be created.")) {
      return;
    }
    const res = await fetch(`/api/metric-types/${metricTypeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoLogDose: null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `Save failed (${res.status})`);
      return;
    }
    setSavedMsg("Auto-log stopped.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="border border-border rounded p-4 mb-6">
      <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
        Auto-log
      </div>
      {enabled ? (
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[0.875rem]">
            {initialDose}
            {unit && <span className="text-muted">{unit}</span>}
          </span>
          <span className="text-[0.8125rem] text-text-secondary">
            daily at noon local
            {initialSince && (
              <>
                , since <span className="font-mono">{initialSince}</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={stop}
            disabled={pending}
            className="px-3 py-1 text-[0.8125rem] border border-border rounded hover:border-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Stop"}
          </button>
          {savedMsg && (
            <span className="font-mono text-[0.6875rem] text-accent-green">{savedMsg}</span>
          )}
          {error && (
            <span className="font-mono text-[0.6875rem] text-accent-red">{error}</span>
          )}
        </div>
      ) : (
        <div className="flex items-baseline gap-3 flex-wrap">
          <label className="flex items-baseline gap-2 text-[0.875rem]">
            <span className="text-text-secondary">Dose:</span>
            <input
              type="text"
              inputMode="decimal"
              value={dose}
              onChange={(e) => {
                setDose(e.target.value);
                setSavedMsg(null);
              }}
              placeholder={defaultDose != null ? String(defaultDose) : "180"}
              className="w-24 px-2 py-1 border border-border rounded font-mono text-[0.8125rem] focus:outline-none focus:border-foreground bg-background"
            />
            {unit && <span className="font-mono text-[0.8125rem] text-muted">{unit}</span>}
          </label>
          <label className="flex items-baseline gap-2 text-[0.875rem]">
            <span className="text-text-secondary">Started taking on:</span>
            <input
              type="date"
              value={since}
              max={today}
              onChange={(e) => {
                setSince(e.target.value);
                setSavedMsg(null);
              }}
              className="px-2 py-1 border border-border rounded font-mono text-[0.8125rem] focus:outline-none focus:border-foreground bg-background"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dose.trim()}
            className="px-3 py-1 text-[0.8125rem] border border-border rounded hover:border-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Auto-log daily"}
          </button>
          {savedMsg && (
            <span className="font-mono text-[0.6875rem] text-accent-green">{savedMsg}</span>
          )}
          {error && (
            <span className="font-mono text-[0.6875rem] text-accent-red">{error}</span>
          )}
        </div>
      )}
      <p className="mt-2 text-[0.75rem] text-muted">
        Stamps one row per day at noon local with the dose above. Set
        &ldquo;Started taking on&rdquo; in the past to back-fill — missed
        days can be deleted from the history table below; the schedule
        won&apos;t re-create them.
      </p>
    </div>
  );
}

/**
 * Today's date in the user's browser-local timezone, YYYY-MM-DD. Used
 * as the default + max for the date picker. Picking the browser-local
 * day (vs the user's stored IANA timezone from app_settings) keeps
 * the picker behavior matching what the user sees on the device.
 */
function todayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
