import Link from "next/link";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { DataTabs } from "../tabs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: string;
}

export default async function AllEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Build WHERE clause from the date range. `started_at` is stored as ISO
  // with time; we compare against day-boundary ISO strings since that
  // works with SQLite's text-string comparison.
  const conditions = [];
  if (from) conditions.push(gte(events.startedAt, `${from}T00:00:00.000Z`));
  if (to) conditions.push(lte(events.startedAt, `${to}T23:59:59.999Z`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(events)
    .where(where);
  const total = Number(totalRow[0]?.c ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const rows = await db
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
    .where(where)
    .orderBy(desc(events.startedAt))
    .limit(PAGE_SIZE)
    .offset((currentPage - 1) * PAGE_SIZE);

  const baseQs = new URLSearchParams();
  if (from) baseQs.set("from", from);
  if (to) baseQs.set("to", to);
  const linkWithPage = (p: number) => {
    const qs = new URLSearchParams(baseQs);
    if (p !== 1) qs.set("page", String(p));
    const str = qs.toString();
    return `/data/events${str ? "?" + str : ""}`;
  };

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Every row Delta has stored. Click an event to view, edit, add, or delete data points.
      </p>

      <DataTabs active="events" />

      <div className="flex items-baseline justify-between mb-6 gap-3">
        <span className="font-mono text-[0.6875rem] text-muted">
          {total.toLocaleString()} total · page {currentPage} of {pageCount}
        </span>
        <Link
          href="/data/events/new"
          className="px-3 py-1.5 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface"
        >
          + New event
        </Link>
      </div>

      {/* Date filter form - plain GET form so state lives in the URL. */}
      <form method="get" action="/data/events" className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-1">
            From
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="px-2 py-1.5 border border-border rounded text-[0.8125rem] font-mono"
          />
        </div>
        <div>
          <label className="block text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-1">
            To
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="px-2 py-1.5 border border-border rounded text-[0.8125rem] font-mono"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90"
        >
          Filter
        </button>
        {(from || to) && (
          <Link
            href="/data/events"
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  No events in this range.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-4 text-[0.8125rem]">
          <div className="flex gap-2">
            {currentPage > 1 ? (
              <Link href={linkWithPage(currentPage - 1)} className="px-3 py-1.5 border border-border rounded hover:bg-surface">
                ← Prev
              </Link>
            ) : (
              <span className="px-3 py-1.5 border border-border rounded text-muted opacity-50">← Prev</span>
            )}
            {currentPage < pageCount ? (
              <Link href={linkWithPage(currentPage + 1)} className="px-3 py-1.5 border border-border rounded hover:bg-surface">
                Next →
              </Link>
            ) : (
              <span className="px-3 py-1.5 border border-border rounded text-muted opacity-50">Next →</span>
            )}
          </div>
          <span className="font-mono text-[0.6875rem] text-muted">
            Page {currentPage} / {pageCount}
          </span>
        </div>
      )}
    </div>
  );
}

function isIsoDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
