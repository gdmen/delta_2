import type { BulkDeleteResult } from "@/components/selectable-data-table";

/**
 * Fan out DELETE /api/metric-types/:id for each selected row, in
 * parallel, then aggregate per-row outcomes into a single result.
 *
 * - 200/204: counts as a success.
 * - 409 (still referenced — goals, workout_sets, event_metrics, or
 *   metrics rows pin it): caller-friendly message naming the row +
 *   the per-table counts so the user can clean up manually.
 * - 404 / 500 / network: bubble the server message up.
 *
 * Used by /data (Metrics tab) and /data/exercises — both back onto
 * metric_types rows. The `getId` and `getName` lambdas let each
 * caller pass its own row shape without a wrapper.
 */
export async function deleteMetricTypesBulk<T>(
  rows: T[],
  getId: (row: T) => number,
  getName: (row: T) => string,
): Promise<BulkDeleteResult<T>> {
  const settled = await Promise.allSettled(
    rows.map(async (row) => {
      const res = await fetch(`/api/metric-types/${getId(row)}`, {
        method: "DELETE",
      });
      if (res.ok) return { row, ok: true as const };
      let message = `${getName(row)}: HTTP ${res.status}`;
      try {
        const json = (await res.json()) as { error?: string; counts?: Record<string, number> };
        if (json.error) message = `${getName(row)}: ${json.error}`;
        if (json.counts) {
          // 409 carries per-table reference counts. Surface the
          // non-zero ones so the user knows what's holding the row.
          const refs = Object.entries(json.counts)
            .filter(([, c]) => c > 0)
            .map(([k, c]) => `${c} ${k}`);
          if (refs.length > 0) message += ` (${refs.join(", ")})`;
        }
      } catch {
        // Response wasn't JSON; keep the default HTTP message.
      }
      return { row, ok: false as const, message };
    }),
  );

  const deleted: T[] = [];
  const errors: { row: T; message: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const row = rows[i];
    if (s.status === "rejected") {
      errors.push({
        row,
        message: `${getName(row)}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
      });
    } else if (s.value.ok) {
      deleted.push(s.value.row);
    } else {
      errors.push({ row: s.value.row, message: s.value.message });
    }
  }
  return { deleted, errors };
}

/**
 * Same shape but for activities. Hits DELETE /api/activities/:id which
 * applies the same FK-reference policy as metric_types.
 */
export async function deleteActivitiesBulk<T>(
  rows: T[],
  getId: (row: T) => number,
  getName: (row: T) => string,
): Promise<BulkDeleteResult<T>> {
  const settled = await Promise.allSettled(
    rows.map(async (row) => {
      const res = await fetch(`/api/activities/${getId(row)}`, { method: "DELETE" });
      if (res.ok) return { row, ok: true as const };
      let message = `${getName(row)}: HTTP ${res.status}`;
      try {
        const json = (await res.json()) as { error?: string; counts?: Record<string, number> };
        if (json.error) message = `${getName(row)}: ${json.error}`;
        if (json.counts) {
          const refs = Object.entries(json.counts)
            .filter(([, c]) => c > 0)
            .map(([k, c]) => `${c} ${k}`);
          if (refs.length > 0) message += ` (${refs.join(", ")})`;
        }
      } catch {
        // not JSON
      }
      return { row, ok: false as const, message };
    }),
  );

  const deleted: T[] = [];
  const errors: { row: T; message: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const row = rows[i];
    if (s.status === "rejected") {
      errors.push({
        row,
        message: `${getName(row)}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
      });
    } else if (s.value.ok) {
      deleted.push(s.value.row);
    } else {
      errors.push({ row: s.value.row, message: s.value.message });
    }
  }
  return { deleted, errors };
}
