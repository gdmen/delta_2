import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { sports, events, focuses, workoutSets, goals, metricTypes } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { GoalBar } from "@/components/goal-bar";
import { computeGoalProgress, formatRate } from "@/lib/goal-calc";

export const dynamic = "force-dynamic";

export default async function SportDetailPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport: sportName } = await params;

  const sportRows = await db
    .select()
    .from(sports)
    .where(eq(sports.name, sportName.toLowerCase()))
    .limit(1);

  if (sportRows.length === 0) notFound();
  const sport = sportRows[0];

  const activeFocuses = await db
    .select()
    .from(focuses)
    .where(and(eq(focuses.sportId, sport.id), eq(focuses.status, "active")))
    .orderBy(desc(focuses.startDate));

  const recentEvents = await db
    .select()
    .from(events)
    .where(eq(events.sportId, sport.id))
    .orderBy(desc(events.startedAt))
    .limit(20);

  // Goals for this sport with computed progress.
  const goalRows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .where(eq(goals.sportId, sport.id));

  const sportGoals = await Promise.all(
    goalRows.map(async (g) => ({
      ...g,
      sportName: sport.name,
      sportColor: sport.color,
      progress: await computeGoalProgress({ ...g, sportName: sport.name, sportColor: sport.color }),
    }))
  );

  // For powerlifting: grab PR-relevant workout sets.
  const recentSets = sport.name === "powerlifting"
    ? await db
        .select()
        .from(workoutSets)
        .orderBy(desc(workoutSets.id))
        .limit(30)
    : [];

  const totalMinutes = recentEvents.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const sessionsThisMonth = recentEvents.filter((e) => {
    const eventDate = new Date(e.startedAt);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return eventDate >= thirtyDaysAgo;
  }).length;

  const displayName = sport.name === "bjj" ? "BJJ" : sport.name.charAt(0).toUpperCase() + sport.name.slice(1);

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center gap-3 mb-6">
        <span
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: sport.color }}
        />
        <h1 className="text-2xl font-semibold">{displayName}</h1>
      </div>

      {/* Summary stats — goals first, per "goals are fundamental, focuses advance them". */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border mb-8">
        <StatCell label="Goals" value={String(sportGoals.length)} />
        <StatCell label="Focuses" value={String(activeFocuses.length)} />
        <StatCell label="Sessions (30d)" value={String(sessionsThisMonth)} />
        <StatCell label="Total Time (30d)" value={`${Math.round(totalMinutes / 60)}h`} />
      </div>

      {/* Goals for this sport */}
      <section className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Goals</span>
          <span className="font-mono text-[0.6875rem] text-muted">{sportGoals.length}</span>
        </div>
        {sportGoals.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No goals set for {displayName}.{" "}
            <Link href="/input/goal" className="text-foreground underline">Add one →</Link>
          </p>
        ) : (
          sportGoals.map((g) => {
            const p = g.progress;
            const uiStatus: "complete" | "on-track" | "behind" | "critical" =
              p.status === "complete"
                ? "complete"
                : p.status === "on-track"
                ? "on-track"
                : p.status === "behind"
                ? "behind"
                : "critical";
            return (
              <GoalBar
                key={g.id}
                name={`${g.metricName} ${g.targetValue}${g.metricUnit}`}
                deadline={g.deadline}
                daysLeft={p.daysRemaining}
                progress={p.progress}
                actualRate={formatRate(p.actualRatePerWeek, g.metricUnit)}
                requiredRate={formatRate(p.requiredRatePerWeek, g.metricUnit)}
                status={uiStatus}
                href={`/goals/${g.id}`}
                sportColor={g.sportColor}
              />
            );
          })
        )}
      </section>

      {/* Active focuses */}
      <section className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Focuses</span>
          <span className="font-mono text-[0.6875rem] text-muted">{activeFocuses.length}</span>
        </div>
        {activeFocuses.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No active focuses for {displayName}.{" "}
            <Link href="/input/focus" className="text-foreground underline">Start one →</Link>
          </p>
        ) : (
          activeFocuses.map((f) => (
            <Link
              key={f.id}
              href={`/focuses/${f.id}`}
              className="block py-2 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded"
            >
              <div className="text-[0.875rem] font-medium">{f.name}</div>
              <div className="font-mono text-[0.6875rem] text-muted">
                Started {f.startDate}
              </div>
            </Link>
          ))
        )}
      </section>

      {/* Recent events */}
      <section className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Recent Sessions</span>
          <span className="font-mono text-[0.6875rem] text-muted">{recentEvents.length}</span>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No sessions logged yet.
            {sport.name === "bjj" && <> <Link href="/input/bjj" className="text-foreground underline">Log a BJJ session →</Link></>}
          </p>
        ) : (
          recentEvents.map((e) => (
            <div key={e.id} className="flex justify-between items-center py-2 border-b border-surface last:border-b-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-[0.75rem] text-muted w-20 flex-shrink-0">
                  {e.startedAt.slice(0, 10)}
                </span>
                <span className="text-[0.8125rem] uppercase font-semibold text-text-secondary">{e.type}</span>
                {e.notes && (
                  <span className="text-[0.8125rem] text-text-secondary truncate">{e.notes}</span>
                )}
              </div>
              {e.durationMinutes !== null && (
                <span className="font-mono text-[0.8125rem] text-muted whitespace-nowrap">
                  {e.durationMinutes} min
                </span>
              )}
            </div>
          ))
        )}
      </section>

      {/* Powerlifting-specific: recent lifts */}
      {sport.name === "powerlifting" && recentSets.length > 0 && (
        <section className="mb-8">
          <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
            <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Recent Sets</span>
            <span className="font-mono text-[0.6875rem] text-muted">{recentSets.length}</span>
          </div>
          {recentSets.slice(0, 15).map((s) => (
            <div key={s.id} className="flex justify-between items-center py-1.5 border-b border-surface last:border-b-0 font-mono text-[0.8125rem]">
              <span className="text-foreground">{s.exerciseName}</span>
              <span className="text-text-secondary">
                {s.reps}×{s.weight}{s.rpe !== null ? ` @ RPE ${s.rpe}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-3">
      <div className="text-[0.6875rem] text-muted uppercase tracking-wider font-medium">{label}</div>
      <div className="font-mono text-[1.25rem] font-medium mt-1">{value}</div>
    </div>
  );
}
