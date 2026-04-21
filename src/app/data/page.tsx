import Link from "next/link";
import { db } from "@/db";
import { metrics, events, sports, metricTypes } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Top-level data browser. Lists every metric_type (with row counts) and
 * recent events, each linking to a CRUD editor.
 */
export default async function DataPage() {
  const metricTypeRows = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      count: sql<number>`count(${metrics.id})`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metricTypes)
    .leftJoin(metrics, eq(metrics.metricTypeId, metricTypes.id))
    .groupBy(metricTypes.id)
    .orderBy(sql`count(${metrics.id}) desc`);

  const recentEvents = await db
    .select({
      id: events.id,
      startedAt: events.startedAt,
      sportName: sports.name,
      type: events.type,
      durationMinutes: events.durationMinutes,
      source: events.source,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .orderBy(desc(events.startedAt))
    .limit(50);

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Every row Delta has stored. Click a metric type or event to view, edit, add, or delete.
      </p>

      {/* Metrics */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Metrics
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">
            {metricTypeRows.length} types
          </span>
        </div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-24">Rows</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-40">Last</th>
              </tr>
            </thead>
            <tbody>
              {metricTypeRows.map((t) => (
                <tr key={t.id} className="relative border-t border-border hover:bg-surface/40">
                  <td className="px-3 py-2 font-mono">
                    {/* Overlay-link makes the whole row clickable without
                        breaking <table> semantics. Per-cell interactive
                        children would need z-index:1 to sit above it. */}
                    <Link
                      href={`/data/metrics/${encodeURIComponent(t.name)}`}
                      className="absolute inset-0"
                      aria-label={`Open ${t.name}`}
                    />
                    {t.name}
                    {t.unit && <span className="text-muted"> ({t.unit})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {Number(t.count).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {t.lastAt ? formatShort(t.lastAt) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Events */}
      <section>
        <div className="flex items-baseline justify-between mb-3 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Recent events
          </h2>
          <Link href="/data/events" className="font-mono text-[0.6875rem] text-muted hover:text-foreground">
            View all →
          </Link>
        </div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2">Started at</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Sport</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Type</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-20">Dur.</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((e) => (
                <tr key={e.id} className="relative border-t border-border hover:bg-surface/40">
                  <td className="px-3 py-2 font-mono tabular-nums">
                    <Link
                      href={`/data/events/${e.id}`}
                      className="absolute inset-0"
                      aria-label={`Open event ${e.id}`}
                    />
                    {formatShort(e.startedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono">{e.sportName}</td>
                  <td className="px-3 py-2 font-mono text-muted">{e.type}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {e.durationMinutes ?? "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[0.75rem] text-muted">{e.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
