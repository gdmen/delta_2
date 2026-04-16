import { db } from "@/db";
import { focuses, sports, goals, metricTypes, focusEntries } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getDailySummaries, daysAgo, today, DailySummary } from "./pre-aggregate";
import { computeGoalProgress } from "@/lib/goal-calc";

export interface CoachContext {
  dateRange: string;
  dailySummaries: DailySummary[];
  activeFocuses: Array<{
    name: string;
    sport: string;
    weeksActive: number;
    technicalNotes: string | null;
    recentEntries: string[];
    linkedGoal: string | null;
  }>;
  activeGoals: Array<{
    metric: string;
    sport: string;
    target: number;
    unit: string;
    deadline: string;
    daysRemaining: number;
    currentValue: number | null;
    progressPct: number;
    requiredRatePerWeek: number | null;
    actualRatePerWeek: number | null;
    status: string;
  }>;
}

export async function assembleBriefingContext(days = 7): Promise<CoachContext> {
  const start = daysAgo(days);
  const end = today();

  const dailySummaries = await getDailySummaries(start, end);

  const focusRows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      sportName: sports.name,
      startDate: focuses.startDate,
      technicalNotes: focuses.technicalNotes,
      goalId: focuses.goalId,
      goalMetric: metricTypes.name,
      goalTarget: goals.targetValue,
      goalUnit: metricTypes.unit,
      goalDeadline: goals.deadline,
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
    .leftJoin(goals, eq(focuses.goalId, goals.id))
    .leftJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .where(eq(focuses.status, "active"));

  const activeFocuses = await Promise.all(
    focusRows.map(async (f) => {
      const entries = await db
        .select({ content: focusEntries.content })
        .from(focusEntries)
        .where(eq(focusEntries.focusId, f.id))
        .orderBy(desc(focusEntries.createdAt))
        .limit(3);

      const weeksActive = Math.max(
        1,
        Math.ceil((Date.now() - new Date(f.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000))
      );

      const linkedGoal =
        f.goalId && f.goalMetric && f.goalTarget !== null && f.goalUnit && f.goalDeadline
          ? `${f.goalMetric} → ${f.goalTarget}${f.goalUnit} by ${f.goalDeadline}`
          : null;

      return {
        name: f.name,
        sport: f.sportName,
        weeksActive,
        technicalNotes: f.technicalNotes,
        recentEntries: entries.map((e) => e.content),
        linkedGoal,
      };
    })
  );

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
    .innerJoin(sports, eq(goals.sportId, sports.id));

  const activeGoals = await Promise.all(
    goalRows.map(async (g) => {
      const p = await computeGoalProgress(g);
      return {
        metric: g.metricName,
        sport: g.sportName,
        target: g.targetValue,
        unit: g.metricUnit,
        deadline: g.deadline,
        daysRemaining: p.daysRemaining,
        currentValue: p.currentValue,
        progressPct: p.progress,
        requiredRatePerWeek: p.requiredRatePerWeek,
        actualRatePerWeek: p.actualRatePerWeek,
        status: p.status,
      };
    })
  );

  return {
    dateRange: `${start} to ${end}`,
    dailySummaries,
    activeFocuses,
    activeGoals,
  };
}

export function formatContextForLLM(ctx: CoachContext): string {
  const lines: string[] = [];
  lines.push(`# Training Context (${ctx.dateRange})`);
  lines.push("");

  lines.push("## Daily Summaries (most recent first)");
  if (ctx.dailySummaries.length === 0) {
    lines.push("_No data recorded in this window._");
  } else {
    for (const day of ctx.dailySummaries) {
      lines.push(`### ${day.date}`);
      const metricEntries = Object.entries(day.metrics);
      if (metricEntries.length > 0) {
        for (const [name, m] of metricEntries) {
          if (m.count === 1) {
            lines.push(`- ${name}: ${m.avg.toFixed(2)} ${m.unit}`);
          } else {
            lines.push(`- ${name}: avg ${m.avg.toFixed(2)} ${m.unit} (min ${m.min.toFixed(2)}, max ${m.max.toFixed(2)}, n=${m.count})`);
          }
        }
      }
      if (day.events.length > 0) {
        for (const e of day.events) {
          const duration = e.durationMinutes ? ` (${e.durationMinutes} min)` : "";
          lines.push(`- event: ${e.sport} / ${e.type}${duration}`);
        }
      }
      if (metricEntries.length === 0 && day.events.length === 0) {
        lines.push("- no data");
      }
    }
  }
  lines.push("");

  // Goals first: they are the fundamental targets. Focuses are tools that advance them.
  lines.push("## Goals (the fundamental targets)");
  if (ctx.activeGoals.length === 0) {
    lines.push("_No goals set._");
  } else {
    for (const g of ctx.activeGoals) {
      const current = g.currentValue !== null ? `${g.currentValue.toFixed(1)}${g.unit}` : "no data";
      const req = g.requiredRatePerWeek !== null ? `${g.requiredRatePerWeek.toFixed(2)}${g.unit}/wk` : "—";
      const act = g.actualRatePerWeek !== null ? `${g.actualRatePerWeek.toFixed(2)}${g.unit}/wk (last 4 wk trend)` : "insufficient data";
      lines.push(
        `- ${g.sport}: ${g.metric} → ${g.target}${g.unit} by ${g.deadline} (${g.daysRemaining}d left). ` +
        `Now: ${current}. Progress: ${g.progressPct.toFixed(0)}%. ` +
        `Required: ${req}. Actual: ${act}. Status: ${g.status}.`
      );
    }
  }
  lines.push("");

  lines.push("## Active Focuses (tools advancing the goals above)");
  if (ctx.activeFocuses.length === 0) {
    lines.push("_No active focuses._");
  } else {
    for (const f of ctx.activeFocuses) {
      lines.push(`### ${f.name} (${f.sport}, week ${f.weeksActive})`);
      if (f.linkedGoal) lines.push(`Advances goal: ${f.linkedGoal}`);
      else lines.push(`Advances goal: (not linked to a goal)`);
      if (f.technicalNotes) lines.push(`Plan: ${f.technicalNotes}`);
      if (f.recentEntries.length > 0) {
        lines.push("Recent entries:");
        for (const e of f.recentEntries) lines.push(`- ${e}`);
      }
    }
  }

  return lines.join("\n");
}
