import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { focuses, sports, focusEntries, focusMetricLinks, metricTypes, metrics, goals } from "@/db/schema";
import { eq, desc, and, gte, lte, ne } from "drizzle-orm";
import { FocusEntryForm } from "./entry-form";
import { CloseFocusButton } from "./close-button";
import { EditableFocusName } from "./editable-name";
import { EditableFocusNotes } from "./editable-notes";
import { ReopenFocusButton } from "./reopen-button";
import { LinkedGoalPicker } from "./linked-goal-picker";

export const dynamic = "force-dynamic";

export default async function FocusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      sportId: focuses.sportId,
      sportName: sports.name,
      sportColor: sports.color,
      goalId: focuses.goalId,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
    .where(eq(focuses.id, id))
    .limit(1);

  if (rows.length === 0) notFound();
  const focus = rows[0];

  // Pull goals for this sport - used by the linked-goal picker. Include the
  // current goal even if complete so it still shows.
  const sportGoalRows = await db
    .select({
      id: goals.id,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .where(and(eq(goals.sportId, focus.sportId), ne(goals.status, "abandoned")));

  const entries = await db
    .select()
    .from(focusEntries)
    .where(eq(focusEntries.focusId, id))
    .orderBy(desc(focusEntries.createdAt));

  const linkedMetrics = await db
    .select({ metricName: metricTypes.name, unit: metricTypes.unit })
    .from(focusMetricLinks)
    .innerJoin(metricTypes, eq(focusMetricLinks.metricTypeId, metricTypes.id))
    .where(eq(focusMetricLinks.focusId, id));

  // Pull recent samples for linked metrics within the focus window.
  const endBound = focus.endDate ? `${focus.endDate}T23:59:59Z` : new Date().toISOString();
  const startBound = `${focus.startDate}T00:00:00Z`;

  const linkedSamples = await Promise.all(
    linkedMetrics.map(async (lm) => {
      const samples = await db
        .select({ value: metrics.value, recordedAt: metrics.recordedAt })
        .from(metrics)
        .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
        .where(and(
          eq(metricTypes.name, lm.metricName),
          gte(metrics.recordedAt, startBound),
          lte(metrics.recordedAt, endBound),
        ))
        .orderBy(metrics.recordedAt);
      return { name: lm.metricName, unit: lm.unit, samples };
    })
  );

  const startMs = new Date(focus.startDate).getTime();
  const endMs = focus.endDate ? new Date(focus.endDate).getTime() : Date.now();
  const weeks = Math.max(1, Math.ceil((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)));

  return (
    <div className="max-w-[820px]">
      {/* Header */}
      <div className="mb-6">
        <Link href="/focuses" className="text-[0.8125rem] text-muted hover:text-foreground">
          ← All Focuses
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0 mt-2"
              style={{ backgroundColor: focus.sportColor }}
            />
            <div className="min-w-0 flex-1">
              {focus.status === "active" ? (
                <EditableFocusName focusId={focus.id} initialName={focus.name} />
              ) : (
                <h1 className="text-2xl font-semibold">{focus.name}</h1>
              )}
              <div className="font-mono text-[0.75rem] text-muted mt-1">
                {focus.sportName.toUpperCase()} · Started {focus.startDate}
                {focus.endDate ? ` · Closed ${focus.endDate}` : ` · Week ${weeks}`}
              </div>
            </div>
          </div>
          <StatusBadge status={focus.status} />
        </div>
      </div>

      {/* Linked goal - what this focus is advancing */}
      <section className="mb-8 pb-6 border-b border-border">
        <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
          Advances Goal
        </div>
        <LinkedGoalPicker
          focusId={focus.id}
          editable={focus.status === "active"}
          currentGoalId={focus.goalId}
          availableGoals={sportGoalRows}
        />
      </section>

      {/* Technical notes (editable if active) */}
      <section className="mb-8 pb-6 border-b border-border">
        <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
          The Plan
        </div>
        {focus.status === "active" ? (
          <EditableFocusNotes focusId={focus.id} initialNotes={focus.technicalNotes ?? ""} />
        ) : focus.technicalNotes ? (
          <div className="text-[0.875rem] leading-[1.7] text-text-secondary whitespace-pre-wrap">
            {focus.technicalNotes}
          </div>
        ) : (
          <p className="text-[0.875rem] text-muted italic">No technical plan recorded.</p>
        )}
      </section>

      {/* Linked metrics summary */}
      {linkedSamples.length > 0 && (
        <section className="mb-8 pb-6 border-b border-border">
          <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
            Linked Metrics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {linkedSamples.map((m) => {
              if (m.samples.length === 0) {
                return (
                  <div key={m.name}>
                    <div className="text-[0.75rem] text-muted uppercase tracking-wider">{m.name}</div>
                    <div className="font-mono text-[1.125rem] text-muted mt-1">-</div>
                  </div>
                );
              }
              const first = m.samples[0].value;
              const last = m.samples[m.samples.length - 1].value;
              const delta = last - first;
              const deltaSign = delta > 0 ? "+" : "";
              return (
                <div key={m.name}>
                  <div className="text-[0.75rem] text-muted uppercase tracking-wider">{m.name}</div>
                  <div className="font-mono text-[1.125rem] mt-1">
                    {last.toFixed(1)}{m.unit}
                  </div>
                  <div className={`font-mono text-[0.6875rem] ${delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"}`}>
                    {deltaSign}{delta.toFixed(1)} from start · {m.samples.length} samples
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Add entry form (only if active) */}
      {focus.status === "active" && (
        <section className="mb-8 pb-6 border-b border-border">
          <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
            Add to Case File
          </div>
          <FocusEntryForm focusId={id} />
        </section>
      )}

      {/* Case file */}
      <section>
        <div className="flex justify-between items-baseline mb-4 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Case File</span>
          <span className="font-mono text-[0.6875rem] text-muted">{entries.length} entries</span>
        </div>
        {entries.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No entries yet. Add training notes as you go - what you drilled, what felt good, what needs work. The
            coach reads these to understand your training beyond just the numbers.
          </p>
        ) : (
          <div className="space-y-5">
            {entries.map((e) => (
              <article key={e.id} className="pb-5 border-b border-surface last:border-b-0">
                <div className="font-mono text-[0.6875rem] text-muted mb-2">
                  {formatEntryDate(e.createdAt)}
                </div>
                <div className="text-[0.875rem] leading-[1.7] text-text-secondary whitespace-pre-wrap">
                  {e.content}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {focus.status === "active" && (
        <div className="mt-8 pt-6 border-t border-border">
          <CloseFocusButton focusId={id} />
        </div>
      )}

      {focus.status !== "active" && (
        <div className="mt-8 pt-6 border-t border-border">
          <ReopenFocusButton focusId={id} currentStatus={focus.status} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    active: { label: "ACTIVE", color: "text-accent-green border-accent-green" },
    completed: { label: "COMPLETED", color: "text-muted border-border" },
    abandoned: { label: "ABANDONED", color: "text-accent-orange border-accent-orange" },
  }[status] ?? { label: status.toUpperCase(), color: "text-muted border-border" };

  return (
    <span className={`font-mono text-[0.6875rem] font-semibold uppercase tracking-wider px-2 py-1 border rounded ${config.color}`}>
      {config.label}
    </span>
  );
}

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 5);
  return `${date} · ${time}`;
}
