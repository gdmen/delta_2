import Link from "next/link";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { DataTabShell } from "@/components/data-tab-shell";
import { PaginationControls } from "@/components/pagination-controls";
import { formatShort } from "@/lib/format";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  q?: string;    // free-text filter: sport name / type / source / notes
  page?: string;
}

export default async function AllEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUserOrSignin();
  const sp = await searchParams;
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Build WHERE from date range + optional text match. `started_at` is stored
  // as ISO with time; day-boundary ISO strings work with SQLite's text-string
  // comparison. Text match is OR across sport name, event type, source, notes.
  const conditions = [userScope(user.id).events];
  if (from) conditions.push(gte(events.startedAt, `${from}T00:00:00.000Z`));
  if (to) conditions.push(lte(events.startedAt, `${to}T23:59:59.999Z`));
  if (q) {
    const needle = `%${q}%`;
    conditions.push(
      or(
        like(sports.name, needle),
        like(events.type, needle),
        like(events.source, needle),
        like(events.notes, needle)
      )!
    );
  }
  const where = and(...conditions);

  // Count query needs the join too (text match may reference sports.name).
  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
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
  if (q) baseQs.set("q", q);
  const linkWithPage = (p: number) => {
    const qs = new URLSearchParams(baseQs);
    if (p !== 1) qs.set("page", String(p));
    const str = qs.toString();
    return `/data/events${str ? "?" + str : ""}`;
  };

  return (
    <DataTabShell
      active="events"
      description="Every row Delta has stored. Click an event to view, edit, add, or delete data points."
    >
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

      {/* Date + text filter form — plain GET form so state lives in the URL. */}
      <form method="get" action="/data/events" className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-1">
            Search
          </label>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="sport, type, source, notes..."
            className="w-full px-2 py-1.5 border border-border rounded text-[0.8125rem]"
          />
        </div>
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
        {(from || to || q) && (
          <Link
            href="/data/events"
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <PaginationControls
        currentPage={currentPage}
        pageCount={pageCount}
        linkWithPage={linkWithPage}
        className="mb-4"
      />

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
                  No events match the current filters.
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

      <PaginationControls
        currentPage={currentPage}
        pageCount={pageCount}
        linkWithPage={linkWithPage}
        className="mt-4"
      />
    </DataTabShell>
  );
}

function isIsoDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

