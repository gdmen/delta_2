import Link from "next/link";
import { getSourceActivity } from "@/lib/data-sources/summaries";
import { Wordmark } from "@/components/wordmark";
import { db } from "@/db";
import { importSources } from "@/db/schema";
import { asc } from "drizzle-orm";
import { formatShort } from "@/lib/format";

export const dynamic = "force-dynamic";

type Status = "ready" | "coming-soon";

interface Row {
  status: Status;
  title: string;
  sourceKey: string | null; // metrics/events.source value, or null for non-source rows
  href: string; // where to go for setup + data details; ignored for "coming-soon" rows
}

// Ordering matters - keep ready integrations at the top so the page answers
// "is my data flowing?" at a glance without scrolling.
const ROWS: Row[] = [
  {
    status: "ready",
    title: "Apple Health",
    sourceKey: "apple_health",
    href: "/data-sources/apple-health",
  },
  {
    status: "ready",
    title: "Strava",
    sourceKey: "strava",
    href: "/data-sources/strava",
  },
  {
    status: "ready",
    title: "BodySpec DEXA",
    sourceKey: "bodyspec_dexa",
    href: "/data-sources/bodyspec",
  },
  {
    status: "coming-soon",
    title: "Whoop / Garmin",
    sourceKey: null,
    href: "",
  },
];

// Responsive columns:
//   <640px (mobile): 3 cols - Source / Status / Rows
//   640-767px (sm):  4 cols - ... + Last
//   >=768px (md):    5 cols - ... + Earliest + Last
// Hidden cells use display:none so they don't consume a grid slot.
// Tailwind v4 sort order for arbitrary / custom breakpoints can place the
// custom `tablet:` variant BEFORE `sm:` in the generated CSS, letting sm:
// (640px) override tablet: (840px) at ≥840px. Force priority with `!`.
const GRID_COLS =
  "grid-cols-[minmax(8rem,1.4fr)_5.5rem_4.5rem] " +
  "sm:grid-cols-[minmax(9rem,1.4fr)_5.5rem_4.5rem_9rem] " +
  "tablet:!grid-cols-[minmax(10rem,1.4fr)_5.5rem_4.5rem_9rem_9rem]";

export default async function DataSourcesPage() {
  const activity = await getSourceActivity();

  // Dynamically fold user-defined import sources into the table. Inserted
  // between the built-in "ready" integrations and the "coming soon" tail
  // so they sit alongside the real data pipelines.
  const customSources = await db
    .select()
    .from(importSources)
    .orderBy(asc(importSources.name));

  const customRows: Row[] = customSources.map((s) => ({
    status: "ready",
    title: s.name,
    sourceKey: s.name.toLowerCase().replace(/\s+/g, "_"),
    href: `/data-sources/import/${s.id}`,
  }));

  const rows: Row[] = [
    ...ROWS.slice(0, 3),        // Apple Health, Strava, BodySpec
    ...customRows,              // user-defined
    ...ROWS.slice(3),           // coming-soon
  ];

  return (
    <div className="max-w-[820px]">
      <h1 className="text-2xl font-semibold mb-2">Sources</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Every way data flows into <Wordmark />. Click a source to see imported data and setup.
      </p>

      <div className="border border-border rounded overflow-x-auto max-w-[760px]">
        {/* Header row */}
        <div
          className={`grid ${GRID_COLS} gap-4 bg-surface px-4 py-2.5 text-foreground font-mono text-[0.6875rem] font-semibold uppercase tracking-wider border-b border-border`}
        >
          <div>Source</div>
          <div>Status</div>
          <div className="text-right">Rows</div>
          <div className="hidden tablet:block text-right">Earliest</div>
          <div className="hidden sm:block text-right">Latest</div>
        </div>

        {/* Data rows - ready rows are clickable; coming-soon ones are static
            so they don't imply clickability. */}
        {rows.map((row) => {
          const act = row.sourceKey ? activity[row.sourceKey] : null;
          const totalRows = act ? act.metricRowCount + act.eventRowCount : 0;
          const rowsCell = row.sourceKey ? totalRows.toLocaleString() : "-";
          const firstCell = row.sourceKey
            ? act?.firstDataAt
              ? formatShort(act.firstDataAt)
              : "-"
            : "-";
          const lastCell = row.sourceKey
            ? act?.lastDataAt
              ? formatShort(act.lastDataAt)
              : "-"
            : "-";
          const rowContent = (
            <>
              <div className="font-semibold text-[0.875rem] text-foreground">
                {row.title}
              </div>
              <div>
                <StatusBadge status={row.status} />
              </div>
              <div className="text-right font-mono text-[0.8125rem] tabular-nums text-text-secondary">
                {rowsCell}
              </div>
              <div className="hidden tablet:block text-right text-[0.8125rem] text-text-secondary tabular-nums">
                {firstCell}
              </div>
              <div className="hidden sm:block text-right text-[0.8125rem] text-text-secondary tabular-nums">
                {lastCell}
              </div>
            </>
          );

          if (row.status === "coming-soon") {
            return (
              <div
                key={row.title}
                className={`grid ${GRID_COLS} gap-4 px-4 py-3 items-center border-t border-border text-muted`}
              >
                {rowContent}
              </div>
            );
          }

          return (
            <Link
              key={row.title}
              href={row.href}
              className={`grid ${GRID_COLS} gap-4 px-4 py-3 items-center border-t border-border hover:bg-surface/40 transition-colors`}
            >
              {rowContent}
            </Link>
          );
        })}
      </div>

      <div className="mt-4">
        <Link
          href="/data-sources/import/new"
          className="text-[0.8125rem] text-foreground underline"
        >
          + New custom CSV source
        </Link>
      </div>

    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  // Full class names listed statically so Tailwind picks them up.
  const spec = {
    ready: {
      text: "READY",
      classes: "text-accent-green border-accent-green",
    },
    "coming-soon": {
      text: "SOON",
      classes: "text-muted border-muted",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center justify-center border-2 rounded-md px-2 py-0.5 font-mono text-[0.6875rem] font-bold uppercase tracking-wider ${spec.classes}`}
    >
      {spec.text}
    </span>
  );
}

