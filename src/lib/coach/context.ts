import { db } from "@/db";
import { focuses, sports, goals, metricTypes, focusEntries } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getDailySummaries, daysAgo, today, DailySummary } from "./pre-aggregate";

export interface CoachContext {
  dateRange: string;
  dailySummaries: DailySummary[];
  activeFocuses: Array<{
    name: string;
    sport: string;
    weeksActive: number;
    technicalNotes: string | null;
    recentEntries: string[];
  }>;
  activeGoals: Array<{
    metric: string;
    sport: string;
    target: number;
    unit: string;
    deadline: string;
    daysRemaining: number;
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
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
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

      return {
        name: f.name,
        sport: f.sportName,
        weeksActive,
        technicalNotes: f.technicalNotes,
        recentEntries: entries.map((e) => e.content),
      };
    })
  );

  const goalRows = await db
    .select({
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id));

  const activeGoals = goalRows.map((g) => ({
    metric: g.metricName,
    sport: g.sportName,
    target: g.targetValue,
    unit: g.metricUnit,
    deadline: g.deadline,
    daysRemaining: Math.max(
      0,
      Math.ceil((new Date(g.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    ),
  }));

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

  lines.push("## Active Focuses");
  if (ctx.activeFocuses.length === 0) {
    lines.push("_No active focuses._");
  } else {
    for (const f of ctx.activeFocuses) {
      lines.push(`### ${f.name} (${f.sport}, week ${f.weeksActive})`);
      if (f.technicalNotes) lines.push(`Plan: ${f.technicalNotes}`);
      if (f.recentEntries.length > 0) {
        lines.push("Recent entries:");
        for (const e of f.recentEntries) lines.push(`- ${e}`);
      }
    }
  }
  lines.push("");

  lines.push("## Goals");
  if (ctx.activeGoals.length === 0) {
    lines.push("_No goals set._");
  } else {
    for (const g of ctx.activeGoals) {
      lines.push(`- ${g.sport}: ${g.metric} = ${g.target}${g.unit} by ${g.deadline} (${g.daysRemaining} days left)`);
    }
  }

  return lines.join("\n");
}
