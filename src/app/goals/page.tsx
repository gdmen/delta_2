import Link from "next/link";
import { db } from "@/db";
import { goals, metricTypes, sports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { computeGoalProgress, displayGoalName, formatRate } from "@/lib/goal-calc";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function GoalsListPage() {
  const user = await requireUserOrSignin();
  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      name: goals.name,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
      status: goals.status,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
      sportColor: sports.color,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(userScope(user.id).goals)
    .orderBy(desc(goals.deadline));

  const withProgress = await Promise.all(
    rows.map(async (g) => ({ ...g, progress: await computeGoalProgress(g, user.id) }))
  );

  // Abandoned is persistent (from the DB); everything else buckets on the
  // computed progress for non-abandoned goals.
  const abandoned = withProgress.filter((g) => g.status === "abandoned");
  const live = withProgress.filter((g) => g.status !== "abandoned");
  const active = live.filter((g) => g.progress.status !== "complete" && g.progress.daysRemaining > 0);
  const completed = live.filter((g) => g.progress.status === "complete");
  const expired = live.filter((g) => g.progress.status !== "complete" && g.progress.daysRemaining === 0);

  return (
    <div className="max-w-[820px]">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <Link
          href="/input/goal"
          className="px-4 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90"
        >
          + New Goal
        </Link>
      </div>

      <p className="text-[0.875rem] text-text-secondary mb-8">
        Numeric targets with deadlines. The coach computes your required rate vs the actual trend from the last
        4 weeks of data, and calls out gaps.
      </p>

      <GoalGroup title="Active" items={active} />
      <GoalGroup title="Completed" items={completed} dim />
      <GoalGroup title="Expired" items={expired} dim />
      <GoalGroup title="Abandoned" items={abandoned} dim />
    </div>
  );
}

interface GoalRow {
  id: number;
  name: string | null;
  metricName: string;
  metricUnit: string;
  sportName: string;
  sportColor: string;
  targetValue: number;
  deadline: string;
  progress: Awaited<ReturnType<typeof computeGoalProgress>>;
}

function GoalGroup({ title, items, dim = false }: { title: string; items: GoalRow[]; dim?: boolean }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <span className="font-mono text-[0.6875rem] text-muted">{items.length}</span>
      </div>
      {items.map((g) => {
        const p = g.progress;
        const fillColor =
          p.status === "complete"
            ? "bg-accent-green"
            : p.status === "on-track"
            ? "bg-foreground"
            : p.status === "behind"
            ? "bg-accent-orange"
            : "bg-accent-red";
        const rateColor =
          p.status === "complete"
            ? "text-accent-green"
            : p.status === "on-track"
            ? "text-muted"
            : p.status === "behind"
            ? "text-accent-orange"
            : "text-accent-red";

        return (
          <Link
            key={g.id}
            href={`/goals/${g.id}`}
            className={`block py-3 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded ${dim ? "opacity-70 hover:opacity-100" : ""}`}
          >
            <div className="flex justify-between items-baseline mb-1.5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                  style={{ backgroundColor: g.sportColor }}
                />
                <span className="text-[0.875rem] font-medium truncate">
                  {displayGoalName(g)}
                </span>
              </div>
              <span className="font-mono text-[0.6875rem] text-muted whitespace-nowrap">
                {g.deadline} · {p.daysRemaining}d
              </span>
            </div>
            <div className="h-[3px] bg-surface rounded-[1.5px]">
              <div
                className={`h-full rounded-[1.5px] ${fillColor}`}
                style={{ width: `${Math.min(p.progress, 100)}%` }}
              />
            </div>
            <div className={`font-mono text-[0.6875rem] mt-1 ${rateColor}`}>
              {p.status === "complete"
                ? `✓ Complete · ${p.currentValue?.toFixed(1) ?? "-"}${g.metricUnit}`
                : p.status === "insufficient-data"
                ? "Not enough data yet"
                : `${formatRate(p.actualRatePerWeek, g.metricUnit)} actual · ${formatRate(p.requiredRatePerWeek, g.metricUnit)} needed`}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
