import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { goals, metricTypes, sports, metrics, focuses } from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { computeGoalProgress, formatRate } from "@/lib/goal-calc";
import { MetricTrend } from "@/components/metric-trend";
import { EditableGoalTarget } from "./editable-target";
import { EditableGoalDeadline } from "./editable-deadline";
import { DeleteGoalButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
      sportColor: sports.color,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(eq(goals.id, id))
    .limit(1);

  if (rows.length === 0) notFound();
  const goal = rows[0];

  const progress = await computeGoalProgress(goal);

  // Pull samples from goal creation date onward for the progress chart.
  const samples = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, goal.metricTypeId))
    .orderBy(asc(metrics.recordedAt));

  const chartData = samples.map((s) => ({
    date: s.recordedAt.slice(0, 10),
    value: s.value,
  }));

  // Focuses that are advancing this goal.
  const linkedFocuses = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
    })
    .from(focuses)
    .where(eq(focuses.goalId, goal.id))
    .orderBy(desc(focuses.createdAt));

  const status = progress.status;
  const statusConfig = {
    complete: { label: "COMPLETE", color: "text-accent-green border-accent-green" },
    "on-track": { label: "ON TRACK", color: "text-accent-green border-accent-green" },
    behind: { label: "BEHIND", color: "text-accent-orange border-accent-orange" },
    critical: { label: "CRITICAL", color: "text-accent-red border-accent-red" },
    "insufficient-data": { label: "NO DATA", color: "text-muted border-border" },
  }[status];

  return (
    <div className="max-w-[820px]">
      <Link href="/goals" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← All Goals
      </Link>

      <div className="flex items-start justify-between gap-4 mt-3 mb-6">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0 mt-2"
            style={{ backgroundColor: goal.sportColor }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[0.75rem] font-mono uppercase tracking-wider text-muted mb-1">
              {goal.sportName} · {goal.metricName}
            </div>
            <EditableGoalTarget goalId={goal.id} initialValue={goal.targetValue} unit={goal.metricUnit} />
            <div className="font-mono text-[0.75rem] text-muted mt-2">
              by <EditableGoalDeadline goalId={goal.id} initialDeadline={goal.deadline} />
              {" · "}{progress.daysRemaining}d remaining
            </div>
          </div>
        </div>
        <span className={`font-mono text-[0.6875rem] font-semibold uppercase tracking-wider px-2 py-1 border rounded ${statusConfig.color}`}>
          {statusConfig.label}
        </span>
      </div>

      {/* Progress summary */}
      <section className="mb-8 pb-6 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Current" value={progress.currentValue !== null ? `${progress.currentValue.toFixed(1)}${goal.metricUnit}` : "-"} />
          <Stat label="Progress" value={`${progress.progress.toFixed(0)}%`} />
          <Stat label="Actual rate" value={formatRate(progress.actualRatePerWeek, goal.metricUnit)} />
          <Stat label="Required rate" value={formatRate(progress.requiredRatePerWeek, goal.metricUnit)} />
        </div>
        <div className="mt-4 h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className={
              status === "complete"
                ? "h-full bg-accent-green"
                : status === "on-track"
                ? "h-full bg-foreground"
                : status === "behind"
                ? "h-full bg-accent-orange"
                : "h-full bg-accent-red"
            }
            style={{ width: `${Math.min(progress.progress, 100)}%` }}
          />
        </div>
      </section>

      {/* Trend chart */}
      <section className="mb-8 pb-6 border-b border-border">
        <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
          Trend since goal set
        </div>
        <MetricTrend
          samples={chartData}
          unit={goal.metricUnit}
          target={goal.targetValue}
          color={goal.sportColor}
          height={240}
        />
        <p className="mt-2 text-[0.6875rem] text-muted font-mono">
          Dashed orange line = target. Last 4 weeks of data drive the actual rate.
        </p>
      </section>

      {/* Focuses advancing this goal */}
      <section className="mb-8 pb-6 border-b border-border">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Focuses advancing this goal
          </span>
          <span className="font-mono text-[0.6875rem] text-muted">{linkedFocuses.length}</span>
        </div>
        {linkedFocuses.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No focuses linked yet.{" "}
            <Link href="/input/focus" className="text-foreground underline">Start one →</Link>{" "}
            to work toward this goal.
          </p>
        ) : (
          linkedFocuses.map((f) => {
            const isActive = f.status === "active";
            return (
              <Link
                key={f.id}
                href={`/focuses/${f.id}`}
                className={`flex justify-between items-center gap-3 py-2 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded ${isActive ? "" : "opacity-70 hover:opacity-100"}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                    style={{ backgroundColor: goal.sportColor }}
                  />
                  <div className="min-w-0">
                    <div className="text-[0.875rem] font-medium">{f.name}</div>
                    <div className="font-mono text-[0.6875rem] text-muted">
                      {f.startDate}
                      {f.endDate ? ` → ${f.endDate}` : ""} · {f.status}
                    </div>
                  </div>
                </div>
                <span className="text-muted text-[0.875rem] flex-shrink-0">→</span>
              </Link>
            );
          })
        )}
      </section>

      <div className="mt-8">
        <DeleteGoalButton goalId={goal.id} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.6875rem] text-muted uppercase tracking-wider font-medium">{label}</div>
      <div className="font-mono text-[1.125rem] font-medium mt-1">{value}</div>
    </div>
  );
}
