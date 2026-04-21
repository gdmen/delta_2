import Link from "next/link";
import { db } from "@/db";
import { focuses, sports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function FocusesListPage() {
  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      sportName: sports.name,
      sportColor: sports.color,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
    .orderBy(desc(focuses.startDate));

  const active = rows.filter((f) => f.status === "active");
  const completed = rows.filter((f) => f.status === "completed");
  const abandoned = rows.filter((f) => f.status === "abandoned");

  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Sources
      </Link>
      <div className="flex justify-between items-center mt-3 mb-6">
        <h1 className="text-2xl font-semibold">Focuses</h1>
        <Link
          href="/input/focus"
          className="px-4 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90"
        >
          + New Focus
        </Link>
      </div>

      <p className="text-[0.875rem] text-text-secondary mb-8">
        Training focuses are the core primitive. A focus is a multi-week theme you&apos;re working on, with narrative
        entries that build up a case file over time. The coach reads your focuses and correlates them with your
        metrics to produce causal hypotheses.
      </p>

      <FocusGroup title="Active" items={active} showDuration />
      <FocusGroup title="Completed" items={completed} dim />
      <FocusGroup title="Abandoned" items={abandoned} dim />
    </div>
  );
}

interface FocusRow {
  id: number;
  name: string;
  sportName: string;
  sportColor: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

function FocusGroup({
  title,
  items,
  showDuration = false,
  dim = false,
}: {
  title: string;
  items: FocusRow[];
  showDuration?: boolean;
  dim?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <span className="font-mono text-[0.6875rem] text-muted">{items.length}</span>
      </div>
      {items.map((f) => {
        const startMs = new Date(f.startDate).getTime();
        const endMs = f.endDate ? new Date(f.endDate).getTime() : Date.now();
        const weeks = Math.max(1, Math.ceil((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)));

        return (
          <Link
            key={f.id}
            href={`/focuses/${f.id}`}
            className={`flex justify-between items-center gap-3 py-3 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded ${dim ? "opacity-60" : ""}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                style={{ backgroundColor: f.sportColor }}
              />
              <div className="min-w-0">
                <div className="text-[0.875rem] font-medium">{f.name}</div>
                <div className="font-mono text-[0.6875rem] text-muted">
                  {f.sportName.toUpperCase()} · {f.startDate}
                  {f.endDate ? ` → ${f.endDate}` : ""}
                </div>
              </div>
            </div>
            {showDuration && (
              <span className="font-mono text-[0.75rem] text-text-secondary whitespace-nowrap">
                Week {weeks}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
