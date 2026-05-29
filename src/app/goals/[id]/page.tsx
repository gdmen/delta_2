import { notFound } from "next/navigation";
import { db } from "@/db";
import { goals, metricTypes, activities, metrics, focuses, goalJournalEntries } from "@/db/schema";
import { and, eq, asc, desc, sql } from "drizzle-orm";
import { computeGoalProgress, formatRate } from "@/lib/goal-calc";
import { MetricTrend } from "@/components/metric-trend";
import { EditableGoalName } from "./editable-name";
import { EditableGoalTarget } from "./editable-target";
import { EditableGoalDeadline } from "./editable-deadline";
import { EditableGoalMetric } from "./editable-metric";
import { AbandonGoalButton } from "./delete-button";
import { JournalEntryForm } from "./journal-entry-form";
import { JournalList } from "./journal-list";
import { FocusesTray } from "./focuses-tray";
import { LlmTray } from "./llm-tray";
import { buildSignalsBlock, renderSignalsBlock } from "@/lib/coach/suggest-focuses";
import { getLastSuccessfulCallAt } from "@/lib/coach/track-call";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserOrSignin();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

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
      activityName: activities.name,
      activityColor: activities.color,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(activities, eq(goals.activityId, activities.id))
    .where(and(userScope(user.id).goals, eq(goals.id, id)))
    .limit(1);

  if (rows.length === 0) notFound();
  const goal = rows[0];

  const progress = await computeGoalProgress(goal, user.id);

  const samples = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.metricTypeId, goal.metricTypeId)))
    .orderBy(asc(metrics.recordedAt));

  const chartData = samples.map((s) => ({
    date: s.recordedAt.slice(0, 10),
    value: s.value,
  }));

  // Focuses on this goal — newest first per the locked v1 ordering. Priority
  // ordering is a P2 follow-up (TODOS.md). focuses is INHERIT — already
  // scoped via the eq(focuses.goalId, goal.id) since `goal` was loaded
  // from this user's catalog above.
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
      dismissedAt: focuses.dismissedAt,
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

  const activeFocusCount = goalFocuses.filter(
    (f) => f.status === "active" && f.source === "manual",
  ).length;

  // Split focuses by source. LLM proposals that are still active and not
  // dismissed render in the LLM tray; everything else (manual + closed
  // anything + dismissed) flows into the manual focuses tray.
  const llmSuggestions = goalFocuses
    .filter(
      (f) =>
        f.source === "llm" &&
        f.status === "active" &&
        f.endDate === null &&
        !f.dismissedAt,
    )
    .map((f) => ({ id: f.id, name: f.name, evidence: f.evidence }));
  // Dismissed LLM suggestions also drop out of the manual tray — they're
  // soft-deleted (kept around so the prompt can avoid re-proposing them).
  const trayFocuses = goalFocuses.filter(
    (f) => !llmSuggestions.find((s) => s.id === f.id) && !f.dismissedAt,
  );

  // Pre-aggregate signals for the LLM-tray loading state. Computed server-
  // side so the user sees concrete numbers during the 3-8s LLM wait, not a
  // generic spinner.
  const signals = await buildSignalsBlock(user.id);
  const signalsBlock = renderSignalsBlock(signals);
  const lastSuggestedAt = await getLastSuccessfulCallAt(goal.id, "suggest-focuses", user.id);

  // Catalog passed to the editable-metric dropdown. Filtered + sorted in
  // the client component; we just dump the full list here.
  const allMetricTypes = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
    })
    .from(metricTypes)
    .where(userScope(user.id).metricTypes)
    .orderBy(asc(metricTypes.name));

  return (
    <div className="max-w-[720px]">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0 mt-2"
            style={{ backgroundColor: goal.activityColor }}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-2">
              <EditableGoalName
                goalId={goal.id}
                initialName={goal.name}
                placeholder={`${goal.metricName} ${goal.targetValue}${goal.metricUnit}`}
              />
            </div>
            <div className="mb-1 text-[0.75rem] text-muted uppercase tracking-wider font-mono">
              <EditableGoalMetric
                goalId={goal.id}
                activityName={goal.activityName}
                initialMetricName={goal.metricName}
                options={allMetricTypes}
              />
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
        <LlmTray
          goalId={goal.id}
          initialSuggestions={llmSuggestions}
          signalsBlock={signalsBlock}
          lastSuggestedAt={lastSuggestedAt ? lastSuggestedAt.toISOString() : null}
        />
        <FocusesTray goalId={goal.id} focuses={trayFocuses} />
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
        <JournalList entries={journalEntries} activityColor={goal.activityColor} />
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
          color={goal.activityColor}
          height="15rem"
        />
        <p className="mt-2 text-[0.6875rem] text-muted font-mono">
          Dashed orange line = target. Last 4 weeks of data drive the actual rate.
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
