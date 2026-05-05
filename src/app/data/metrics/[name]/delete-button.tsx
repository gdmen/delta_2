"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Delete the metric_type entirely. Visible only when the parent page has
 * verified zero references (metrics + workout_sets + event_metrics +
 * goals = 0). The API still re-checks server-side and returns 409 with
 * the blocking counts if anything has changed in the meantime.
 *
 * Computed metric_types (e.g. bench_press_max) re-seed on the next
 * `npx tsx src/db/seed.ts` run, so deleting one is effectively a soft
 * reset of any user-edited target/higher_is_better. Caller decides.
 */
export function DeleteMetricTypeButton({
  metricTypeId,
  metricName,
}: {
  metricTypeId: number;
  metricName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (
      !window.confirm(
        `Delete metric "${metricName}"? This removes the metric_type catalog row. ` +
          `Use only when there's no data referencing it.`,
      )
    ) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/metric-types/${metricTypeId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.counts) {
        const refs = Object.entries(j.counts as Record<string, number>)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        setError(`Cannot delete — still referenced (${refs}).`);
      } else {
        setError(j.error ?? `Delete failed (${res.status}).`);
      }
      return;
    }
    startTransition(() => router.push("/data"));
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-[0.8125rem] text-accent-red border border-accent-red rounded px-3 py-1.5 hover:bg-accent-red hover:text-background disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete metric"}
      </button>
      {error && (
        <p className="mt-2 text-[0.75rem] text-accent-red font-mono">{error}</p>
      )}
    </div>
  );
}
