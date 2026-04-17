import Link from "next/link";
import { getSourceActivity } from "@/lib/data-sources/summaries";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";

type Status = "ready" | "coming-soon" | "manual-only";

interface Row {
  status: Status;
  title: string;
  sourceKey: string | null; // metrics/events.source value, or null for manual-only rows
  href: string; // where to go for setup + data details
  summary: React.ReactNode; // one-line description
}

// Ordering matters - keep ready integrations at the top so the page answers
// "is my data flowing?" at a glance without scrolling.
const ROWS: Row[] = [
  {
    status: "ready",
    title: "Apple Health",
    sourceKey: "apple_health",
    href: "/data-sources/apple-health",
    summary: "Sleep, HR, HRV, steps, body metrics, dietary via Health Auto Export.",
  },
  {
    status: "ready",
    title: "Strava",
    sourceKey: "strava",
    href: "/data-sources/strava",
    summary: "OAuth sync of runs, rides, and hikes.",
  },
  {
    status: "ready",
    title: "BodySpec DEXA",
    sourceKey: "bodyspec",
    href: "/data-sources/bodyspec",
    summary: (
      <>
        Upload DEXA PDFs; <Wordmark /> extracts body composition.
      </>
    ),
  },
  {
    status: "manual-only",
    title: "Goals",
    sourceKey: null,
    href: "/goals",
    summary: "Targets with deadlines; coach tracks required rate.",
  },
  {
    status: "manual-only",
    title: "Focuses",
    sourceKey: null,
    href: "/focuses",
    summary: "Narrative training focuses - the core differentiator.",
  },
  {
    status: "manual-only",
    title: "BJJ Sessions",
    sourceKey: null,
    href: "/input/bjj",
    summary: "Mat-time logs categorized by session type.",
  },
  {
    status: "coming-soon",
    title: "TeamBuildr",
    sourceKey: null,
    href: "/data-sources",
    summary: "CSV import of programmed lifts (sets, reps, weight, RPE).",
  },
  {
    status: "coming-soon",
    title: "Whoop / Garmin",
    sourceKey: null,
    href: "/data-sources",
    summary: "Proprietary metrics not in Apple Health (stretch goal).",
  },
];

const GRID_COLS =
  "grid-cols-[1.6fr_5.5rem_5rem_9rem_1.8fr]";

export default async function DataSourcesPage() {
  const activity = await getSourceActivity();

  return (
    <div className="max-w-[940px]">
      <h1 className="text-2xl font-semibold mb-2">Data Sources</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Every way data flows into <Wordmark />. Click a source to see imported data and setup.
      </p>

      <div className="border border-border rounded overflow-hidden">
        {/* Header row */}
        <div
          className={`grid ${GRID_COLS} gap-4 bg-surface px-4 py-2.5 text-foreground font-mono text-[0.6875rem] font-semibold uppercase tracking-wider border-b border-border`}
        >
          <div>Source</div>
          <div>Status</div>
          <div className="text-right">Rows</div>
          <div className="text-right">Last import</div>
          <div>Summary</div>
        </div>

        {/* Data rows - each entire row is a clickable link */}
        {ROWS.map((row) => {
          const act = row.sourceKey ? activity[row.sourceKey] : null;
          const totalRows = act ? act.metricRowCount + act.eventRowCount : 0;

          return (
            <Link
              key={row.title}
              href={row.href}
              className={`grid ${GRID_COLS} gap-4 px-4 py-3 items-center border-t border-border hover:bg-surface/40 transition-colors`}
            >
              <div className="font-semibold text-[0.875rem] text-foreground">
                {row.title}
              </div>
              <div>
                <StatusBadge status={row.status} />
              </div>
              <div className="text-right font-mono text-[0.8125rem] tabular-nums text-text-secondary">
                {row.sourceKey ? totalRows.toLocaleString() : "-"}
              </div>
              <div className="text-right text-[0.8125rem] text-text-secondary tabular-nums">
                {row.sourceKey
                  ? act?.lastImportAt
                    ? formatShort(act.lastImportAt)
                    : "never"
                  : "-"}
              </div>
              <div className="text-[0.8125rem] text-text-secondary">
                {row.summary}
              </div>
            </Link>
          );
        })}
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
    "manual-only": {
      text: "MANUAL",
      classes: "text-sport-pl border-sport-pl",
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
