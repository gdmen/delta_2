"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface MetricOption {
  id: number;
  name: string;
  unit: string;
}

/**
 * Click the goal's "activity · metric" label to swap which metric_type the
 * goal targets. Opens a filterable dropdown of every metric_type in the
 * catalog (incl. computed metrics like bench_press_max). Saving doesn't
 * touch activityId, targetValue, or deadline — just metricTypeId. The unit
 * displayed elsewhere on the page picks up the new metric_type's unit on
 * the next render via router.refresh().
 *
 * Adjusting targetValue after a metric change is the user's job — a
 * 250 lb bench target makes no sense for a sleep_hours goal, but the
 * server doesn't try to be clever about that.
 */
export function EditableGoalMetric({
  goalId,
  activityName,
  initialMetricName,
  options,
}: {
  goalId: number;
  activityName: string;
  initialMetricName: string;
  options: MetricOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the dropdown without committing.
  useEffect(() => {
    if (!editing) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setEditing(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [editing]);

  async function pick(metricTypeId: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricTypeId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      setFilter("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const trimmed = filter.trim().toLowerCase();
  const filtered = trimmed
    ? options.filter((o) => o.name.toLowerCase().includes(trimmed))
    : options;
  // Cap rendered options so a 600-row catalog doesn't paint thousands of
  // DOM nodes when the user first clicks. Filter narrows it quickly.
  const RENDER_CAP = 100;
  const visible = filtered.slice(0, RENDER_CAP);
  const hidden = filtered.length - visible.length;

  if (editing) {
    return (
      <div ref={containerRef} className="relative inline-block">
        <input
          type="text"
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={initialMetricName}
          disabled={saving}
          className="text-[0.75rem] font-mono uppercase tracking-wider bg-transparent border-b border-foreground outline-none w-64"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              setFilter("");
            }
            if (e.key === "Enter" && visible.length > 0) {
              pick(visible[0].id);
            }
          }}
        />
        <div className="absolute z-10 mt-1 w-72 max-h-80 overflow-y-auto bg-background border border-border rounded shadow-lg">
          {visible.length === 0 ? (
            <div className="px-3 py-2 text-[0.75rem] text-muted">
              No metrics match.
            </div>
          ) : (
            <ul>
              {visible.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => pick(o.id)}
                    disabled={saving}
                    className="w-full text-left px-3 py-1.5 text-[0.8125rem] font-mono hover:bg-surface/60 disabled:opacity-50 flex items-baseline justify-between gap-3"
                  >
                    <span className="truncate">{o.name}</span>
                    {o.unit && (
                      <span className="text-[0.6875rem] text-muted flex-shrink-0">
                        {o.unit}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {hidden > 0 && (
                <li className="px-3 py-1.5 text-[0.6875rem] text-muted border-t border-surface">
                  + {hidden} more — keep typing to narrow
                </li>
              )}
            </ul>
          )}
        </div>
        {error && (
          <div className="mt-1 text-[0.6875rem] text-accent-red">{error}</div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-[0.75rem] font-mono uppercase tracking-wider text-muted hover:text-foreground transition-colors"
      title="Click to change metric"
    >
      {activityName} · {initialMetricName}
    </button>
  );
}
