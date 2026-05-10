import { db } from "@/db";
import { metrics, events, metricTypes, sports } from "@/db/schema";
import { and, sql, eq } from "drizzle-orm";
import { formatShort } from "@/lib/format";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * Per-source "what has been imported" summary.
 *
 * Shows one row per metric_type and (optionally) one row per sport's events
 * seen under this source. Intended for the sub-page of a data source so the
 * user can answer "what's in Delta from <source>?" without running SQL.
 *
 * Per-user: scoped to the requesting user's metrics + events.
 */
export async function SourceDataBrowser({ source }: { source: string }) {
  const user = await requireUserOrSignin();

  const metricRows = await db
    .select({
      typeId: metricTypes.id,
      typeName: metricTypes.name,
      unit: metricTypes.unit,
      count: sql<number>`count(*)`,
      firstAt: sql<string>`min(${metrics.recordedAt})`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(and(userScope(user.id).metrics, eq(metrics.source, source)))
    .groupBy(metricTypes.id)
    .orderBy(sql`count(*) desc`);

  const eventRows = await db
    .select({
      sportId: sports.id,
      sportName: sports.name,
      count: sql<number>`count(*)`,
      firstAt: sql<string>`min(${events.startedAt})`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(userScope(user.id).events, eq(events.source, source)))
    .groupBy(sports.id)
    .orderBy(sql`count(*) desc`);

  const totalMetrics = metricRows.reduce((s, r) => s + Number(r.count), 0);
  const totalEvents = eventRows.reduce((s, r) => s + Number(r.count), 0);

  if (totalMetrics === 0 && totalEvents === 0) {
    return (
      <p className="text-[0.8125rem] text-muted">
        No data imported from this source yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {metricRows.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
              Metrics
            </h3>
            <span className="font-mono text-[0.6875rem] text-muted">
              {totalMetrics.toLocaleString()} rows across {metricRows.length} types
            </span>
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-[0.8125rem]">
              <thead className="bg-surface text-muted text-[0.6875rem] uppercase tracking-wider">
                <tr>
                  <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
                  <th className="text-right font-mono font-semibold px-3 py-2">Rows</th>
                  <th className="hidden sm:table-cell text-right font-mono font-semibold px-3 py-2">Earliest</th>
                  <th className="text-right font-mono font-semibold px-3 py-2">Latest</th>
                </tr>
              </thead>
              <tbody>
                {metricRows.map((r) => (
                  <tr key={r.typeId} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2 font-mono">
                      {r.typeName}
                      {r.unit && (
                        <span className="text-muted"> ({r.unit})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {Number(r.count).toLocaleString()}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 text-right text-muted tabular-nums whitespace-nowrap">
                      {r.firstAt ? formatShort(r.firstAt) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-muted tabular-nums whitespace-nowrap">
                      {r.lastAt ? formatShort(r.lastAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {eventRows.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
              Events
            </h3>
            <span className="font-mono text-[0.6875rem] text-muted">
              {totalEvents.toLocaleString()} rows
            </span>
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-[0.8125rem]">
              <thead className="bg-surface text-muted text-[0.6875rem] uppercase tracking-wider">
                <tr>
                  <th className="text-left font-mono font-semibold px-3 py-2">Sport</th>
                  <th className="text-right font-mono font-semibold px-3 py-2">Rows</th>
                  <th className="hidden sm:table-cell text-right font-mono font-semibold px-3 py-2">Earliest</th>
                  <th className="text-right font-mono font-semibold px-3 py-2">Latest</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.map((r) => (
                  <tr key={r.sportId} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2 font-mono">{r.sportName}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {Number(r.count).toLocaleString()}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 text-right text-muted tabular-nums whitespace-nowrap">
                      {r.firstAt ? formatShort(r.firstAt) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-muted tabular-nums whitespace-nowrap">
                      {r.lastAt ? formatShort(r.lastAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
