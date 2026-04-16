import { MetricsStrip } from "@/components/metrics-strip";
import { CoachBriefing } from "@/components/coach-briefing";
import { FocusCard } from "@/components/focus-card";
import { GoalBar } from "@/components/goal-bar";
import { db } from "@/db";
import { focuses, sports, goals, metricTypes, coachMessages } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { getLatestMetric, getAverageLast7Days, getSessionsThisWeek } from "@/lib/metrics-query";

export const dynamic = "force-dynamic";

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function Home() {
  const [sleep, weight, protein, hrv, sessionsCount] = await Promise.all([
    getAverageLast7Days("sleep_hours"),
    getLatestMetric("bodyweight"),
    getAverageLast7Days("protein_g"),
    getLatestMetric("hrv_ms"),
    getSessionsThisWeek(),
  ]);

  const activeFocuses = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      sportName: sports.name,
      sportColor: sports.color,
      startDate: focuses.startDate,
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
    .where(eq(focuses.status, "active"));

  const activeGoals = await db
    .select({
      id: goals.id,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id));

  const todayBriefing = await db
    .select()
    .from(coachMessages)
    .where(and(eq(coachMessages.type, "briefing"), gte(coachMessages.createdAt, startOfTodayISO())))
    .orderBy(desc(coachMessages.createdAt))
    .limit(1);

  let briefingSummary = "";
  let briefingInsight = "";
  let briefingDate = "";
  if (todayBriefing.length > 0) {
    briefingDate = todayBriefing[0].createdAt.slice(0, 10);
    try {
      const parsed = JSON.parse(todayBriefing[0].content);
      briefingSummary = parsed.summary ?? todayBriefing[0].content;
      briefingInsight = parsed.insight ?? "";
    } catch {
      briefingSummary = todayBriefing[0].content;
    }
  }

  return (
    <div>
      <MetricsStrip
        metrics={[
          {
            label: "Sleep",
            value: sleep !== null ? `${sleep.toFixed(1)}h` : "—",
            delta: sleep !== null ? "7-day avg" : "no data",
            status: sleep !== null && sleep < 7 ? "down" : sleep !== null ? "up" : "flat",
          },
          {
            label: "Weight",
            value: weight !== null ? `${weight.value.toFixed(1)}` : "—",
            delta: weight !== null ? weight.unit : "no data",
            status: weight !== null ? "flat" : "flat",
          },
          {
            label: "Protein",
            value: protein !== null ? `${Math.round(protein)}g` : "—",
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
            value: hrv !== null ? `${Math.round(hrv.value)}ms` : "—",
            delta: hrv !== null ? "latest" : "no data",
            status: hrv !== null ? "flat" : "flat",
          },
        ]}
      />

      {todayBriefing.length > 0 ? (
        <CoachBriefing
          date={briefingDate}
          summary={briefingSummary}
          insight={briefingInsight || undefined}
        />
      ) : (
        <div className="border-t-2 border-foreground pt-3 mb-8">
          <p className="text-[14px] text-muted">
            No briefing yet today.{" "}
            <GenerateBriefingLink />{" "}
            or{" "}
            <a href="/input/focus" className="text-foreground underline">create a focus</a>{" "}
            to get started.
          </p>
        </div>
      )}

      <div className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Active Focuses</span>
          <span className="font-mono text-[11px] text-muted">{activeFocuses.length} active</span>
        </div>
        {activeFocuses.length === 0 ? (
          <p className="text-[14px] text-muted py-2">
            No active focuses.{" "}
            <a href="/input/focus" className="text-foreground underline">Start one</a> to track what you are working on.
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
                valueLabel="—"
              />
            );
          })
        )}
      </div>

      <div className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Goals</span>
          <span className="font-mono text-[11px] text-muted">{activeGoals.length} active</span>
        </div>
        {activeGoals.length === 0 ? (
          <p className="text-[14px] text-muted py-2">
            No goals set. Goals with deadlines help the coach track your required rate of progress.
          </p>
        ) : (
          activeGoals.map((g) => {
            const daysLeft = Math.max(0, Math.ceil((new Date(g.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
            return (
              <GoalBar
                key={g.id}
                name={`${g.sportName} · ${g.metricName} ${g.targetValue}${g.metricUnit}`}
                deadline={g.deadline}
                daysLeft={daysLeft}
                progress={0}
                actualRate="—"
                requiredRate="—"
                status="behind"
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function GenerateBriefingLink() {
  return (
    <a
      href="/coach"
      className="text-foreground underline"
    >
      generate one
    </a>
  );
}
