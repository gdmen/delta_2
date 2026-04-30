import { MetricsStrip } from "@/components/metrics-strip";
import { FocusCard } from "@/components/focus-card";
import { GoalBar } from "@/components/goal-bar";
import { db } from "@/db";
import { focuses, sports, goals, metricTypes } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getLatestMetric, getAverageLast7Days, getSessionsThisWeek } from "@/lib/metrics-query";
import { computeGoalProgress, formatRate } from "@/lib/goal-calc";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [sleep, weight, protein, hrv, sessionsCount] = await Promise.all([
    getAverageLast7Days("sleep_hours"),
    getLatestMetric("bodyweight"),
    getAverageLast7Days("protein_g"),
    getLatestMetric("hrv_ms"),
    getSessionsThisWeek(),
  ]);

  // Focuses now reach their sport via the goal they belong to. LLM-suggested
  // focuses (source='llm') stay out of the daily view until the user promotes
  // them — proposals shouldn't masquerade as commitments.
  const activeFocuses = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      goalId: focuses.goalId,
      sportName: sports.name,
      sportColor: sports.color,
      startDate: focuses.startDate,
    })
    .from(focuses)
    .innerJoin(goals, eq(focuses.goalId, goals.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(and(eq(focuses.status, "active"), eq(focuses.source, "manual")));

  const goalRows = await db
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
    .where(ne(goals.status, "abandoned"));

  const activeGoals = await Promise.all(
    goalRows.map(async (g) => ({
      ...g,
      progress: await computeGoalProgress(g),
    }))
  );

  return (
    <div>
      <MetricsStrip
        metrics={[
          {
            label: "Sleep",
            value: sleep !== null ? `${sleep.toFixed(1)}h` : "-",
            delta: sleep !== null ? "7-day avg" : "no data",
            status: sleep !== null && sleep < 7 ? "down" : sleep !== null ? "up" : "flat",
          },
          {
            label: "Weight",
            value: weight !== null ? `${weight.value.toFixed(1)}` : "-",
            delta: weight !== null ? weight.unit : "no data",
            status: weight !== null ? "flat" : "flat",
          },
          {
            label: "Protein",
            value: protein !== null ? `${Math.round(protein)}g` : "-",
            delta: protein !== null ? "7-day avg" : "no data",
            status: protein !== null ? "flat" : "flat",
          },
          {
            label: "Sessions",
            value: String(sessionsCount),
            delta: "this week",
            status: sessionsCount > 0 ? "up" : "flat",
          },
          {
            label: "HRV",
            value: hrv !== null ? `${Math.round(hrv.value)}ms` : "-",
            delta: hrv !== null ? "latest" : "no data",
            status: hrv !== null ? "flat" : "flat",
          },
        ]}
      />

      {/*
        Today view: focuses lead because they are tactical (what you're working
        on right now). Goals follow because they are strategic (the deadline-
        bound targets focuses serve).
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8 max-w-[820px]">
        <div>
          <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
            <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Focuses</span>
            <span className="font-mono text-[0.6875rem] text-muted">{activeFocuses.length} active</span>
          </div>
          {activeFocuses.length === 0 ? (
            <p className="text-[0.875rem] text-muted py-2">
              No active focuses. Open a goal to add focuses to it.
            </p>
          ) : (
            activeFocuses.map((f) => {
              const weeks = Math.max(1, Math.ceil((Date.now() - new Date(f.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000)));
              return (
                <FocusCard
                  key={f.id}
                  name={f.name}
                  sport={f.sportName}
                  sportColor={f.sportColor}
                  weekNumber={weeks}
                  sparklineData={[]}
                  valueLabel="-"
                  href={`/goals/${f.goalId}`}
                />
              );
            })
          )}
        </div>

        <div>
          <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
            <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Goals</span>
            <span className="font-mono text-[0.6875rem] text-muted">{activeGoals.length} active</span>
          </div>
          {activeGoals.length === 0 ? (
            <p className="text-[0.875rem] text-muted py-2">
              No goals set.{" "}
              <a href="/input/goal" className="text-foreground underline">Add one</a> to track required rate of progress.
            </p>
          ) : (
            activeGoals.map((g) => {
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
        </div>
      </div>
    </div>
  );
}
