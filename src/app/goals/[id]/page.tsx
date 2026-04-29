import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { goals, metricTypes, sports, metrics, focuses, goalJournalEntries } from "@/db/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { computeGoalProgress, formatRate } from "@/lib/goal-calc";
import { MetricTrend } from "@/components/metric-trend";
import { EditableGoalTarget } from "./editable-target";
import { EditableGoalDeadline } from "./editable-deadline";
import { AbandonGoalButton } from "./delete-button";
import { JournalEntryForm } from "./journal-entry-form";
import { JournalList } from "./journal-list";
import { FocusesTray } from "./focuses-tray";

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
      status: goals.status,
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

  const samples = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, goal.metricTypeId))
    .orderBy(asc(metrics.recordedAt));

  const chartData = samples.map((s) => ({
    date: s.recordedAt.slice(0, 10),
    value: s.value,
  }));

  // Focuses on this goal — newest first per the locked v1 ordering. Priority
  // ordering is a P2 follow-up (TODOS.md).
  const goalFocuses = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      goalId: focuses.goalId,
      source: focuses.source,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
      evidence: focuses.evidence,
    })
    .from(focuses)
    .where(eq(focuses.goalId, goal.id))
    .orderBy(desc(focuses.startDate));

  // Journal entries: reverse-chronological. LEFT JOIN focuses to surface the
  // verdict focus name when applicable, so the journal item can label itself
  // as "verdict: <focus name>" without a follow-up query.
  const verdictFocus = sql`verdict_focus.name`.mapWith(String).as("verdictFocusName");
  const journalEntries = await db
    .select({
      id: goalJournalEntries.id,
      content: goalJournalEntries.content,
      createdAt: goalJournalEntries.createdAt,
      verdictFocusId: goalJournalEntries.verdictFocusId,
      verdictFocusName: verdictFocus,
    })
    .from(goalJournalEntries)
    .leftJoin(
      sql`${focuses} AS verdict_focus`,
      sql`verdict_focus.id = ${goalJournalEntries.verdictFocusId}`,
    )
    .where(eq(goalJournalEntries.goalId, goal.id))
    .orderBy(desc(goalJournalEntries.createdAt));

  const status = progress.status;
  const statusConfig = {
    complete: { label: "COMPLETE", color: "text-accent-green border-accent-green" },
    "on-track": { label: "ON TRACK", color: "text-accent-green border-accent-green" },
    behind: { label: "BEHIND", color: "text-accent-orange border-accent-orange" },
    critical: { label: "CRITICAL", color: "text-accent-red border-accent-red" },
    "insufficient-data": { label: "NO DATA", color: "text-muted border-border" },
  }[status];

  const activeFocusCount = goalFocuses.filter((f) => f.status === "active").length;

  return (
    <div className="max-w-[720px]">
      {/* HEADER */}
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

      {/* PROGRESS */}
      <section className="mb-8">
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

      {/* FOCUSES */}
      <section className="mb-8 pt-6 border-t border-border">
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Current focuses
          </span>
          <span className="font-mono text-[0.6875rem] text-muted">
            {activeFocusCount} active
          </span>
        </div>
        <FocusesTray goalId={goal.id} focuses={goalFocuses} />
      </section>

      {/* JOURNAL */}
      <section className="mb-8 pt-6 border-t border-border">
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Journal
          </span>
          <span className="font-mono text-[0.6875rem] text-muted">
            {journalEntries.length} {journalEntries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <JournalEntryForm goalId={goal.id} />
        <JournalList entries={journalEntries} sportColor={goal.sportColor} />
      </section>

      {/* TREND */}
      <section className="mb-8 pt-6 border-t border-border">
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

      {/* COACH (placeholder for PR #3) */}
      <section className="mb-8 pt-6 border-t border-border">
        <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
          Coach
        </div>
        <p className="text-[0.8125rem] text-muted">
          LLM-suggested focuses + period summaries arrive in the next PR.
        </p>
      </section>

      <div className="mt-8 pt-6 border-t border-border">
        <AbandonGoalButton
          goalId={goal.id}
          currentStatus={goal.status}
          activeLinkedFocusCount={activeFocusCount}
        />
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
