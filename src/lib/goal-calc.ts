import { db } from "@/db";
import { metrics } from "@/db/schema";
import { and, eq, gte, desc, asc } from "drizzle-orm";
import type { GoalProgress } from "./goal-format";

// Re-export so server callers don't need to know about the split.
export { formatRate, type GoalProgress } from "./goal-format";

export interface GoalSummary {
  id: number;
  metricTypeId: number;
  metricName: string;
  metricUnit: string;
  sportName: string;
  sportColor: string;
  targetValue: number;
  deadline: string;
  createdAt: string;
}

// GoalProgress lives in ./goal-format (re-exported above) so client
// components can import its type without pulling db into their bundle.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Linear regression slope (y per x) via least-squares.
 * x is time in weeks since the first sample, y is the metric value.
 * Returns null if fewer than 3 samples (not enough signal for a trend).
 */
function regressionSlopePerWeek(samples: Array<{ t: number; v: number }>): number | null {
  if (samples.length < 3) return null;

  const xs = samples.map((s) => s.t / MS_PER_WEEK);
  const ys = samples.map((s) => s.v);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export async function computeGoalProgress(goal: GoalSummary): Promise<GoalProgress> {
  const now = Date.now();
  const deadlineTs = new Date(goal.deadline).getTime();
  const daysRemaining = Math.max(0, Math.ceil((deadlineTs - now) / MS_PER_DAY));
  const weeksRemaining = daysRemaining / 7;

  // Parallel fire the four fixed-size lookups; they don't depend on each other.
  const fourWeeksAgo = new Date(now - 4 * MS_PER_WEEK).toISOString();
  // goal.createdAt is SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC).
  // metrics.recordedAt is always ISO ("YYYY-MM-DDTHH:MM:SS..."). Convert so
  // string comparison in `gte` below lines up with chronological ordering.
  const createdAtIso = goal.createdAt.includes("T")
    ? goal.createdAt
    : goal.createdAt.replace(" ", "T") + "Z";
  const [latestRows, afterCreateRows, earliestRows, recentRows] = await Promise.all([
    db
      .select({ value: metrics.value })
      .from(metrics)
      .where(eq(metrics.metricTypeId, goal.metricTypeId))
      .orderBy(desc(metrics.recordedAt))
      .limit(1),
    db
      .select({ value: metrics.value })
      .from(metrics)
      .where(
        and(
          eq(metrics.metricTypeId, goal.metricTypeId),
          gte(metrics.recordedAt, createdAtIso),
        ),
      )
      .orderBy(asc(metrics.recordedAt))
      .limit(1),
    db
      .select({ value: metrics.value })
      .from(metrics)
      .where(eq(metrics.metricTypeId, goal.metricTypeId))
      .orderBy(asc(metrics.recordedAt))
      .limit(1),
    db
      .select({ value: metrics.value, recordedAt: metrics.recordedAt })
      .from(metrics)
      .where(
        and(
          eq(metrics.metricTypeId, goal.metricTypeId),
          gte(metrics.recordedAt, fourWeeksAgo),
        ),
      )
      .orderBy(asc(metrics.recordedAt)),
  ]);

  const currentValue = latestRows[0]?.value ?? null;
  // Start value: earliest sample at or after goal creation, falling back to
  // the earliest sample overall (useful when a goal was set retroactively).
  const startValue = afterCreateRows[0]?.value ?? earliestRows[0]?.value ?? null;

  const direction: "up" | "down" = startValue !== null
    ? (goal.targetValue >= startValue ? "up" : "down")
    : "up";

  // Progress as signed %, clamped [0, 100].
  let progress = 0;
  if (currentValue !== null && startValue !== null && goal.targetValue !== startValue) {
    const raw = (currentValue - startValue) / (goal.targetValue - startValue);
    progress = Math.max(0, Math.min(100, raw * 100));
  }

  // Required rate: remaining distance / weeks remaining (signed by direction).
  let requiredRatePerWeek: number | null = null;
  if (currentValue !== null && weeksRemaining > 0) {
    requiredRatePerWeek = (goal.targetValue - currentValue) / weeksRemaining;
  }

  // Actual rate: linear regression over the last 4 weeks (SQL-filtered above).
  const recent = recentRows.map((r) => ({
    t: new Date(r.recordedAt).getTime(),
    v: r.value,
  }));
  const actualRatePerWeek = regressionSlopePerWeek(recent);

  // Status classification.
  let status: GoalProgress["status"];
  if (currentValue === null) {
    status = "insufficient-data";
  } else if (progress >= 100) {
    status = "complete";
  } else if (requiredRatePerWeek === null || actualRatePerWeek === null) {
    status = "insufficient-data";
  } else if (daysRemaining === 0) {
    status = "critical";
  } else {
    // Compare rates in the direction of progress. For "up" goals, a larger positive
    // actual means better; for "down", a more negative actual means better.
    const requiredMag = Math.abs(requiredRatePerWeek);
    const actualSigned = direction === "up" ? actualRatePerWeek : -actualRatePerWeek;
    const required = direction === "up" ? requiredRatePerWeek : -requiredRatePerWeek;

    if (actualSigned >= required) {
      status = "on-track";
    } else if (actualSigned >= requiredMag * 0.5) {
      status = "behind";
    } else {
      status = "critical";
    }
  }

  return {
    currentValue,
    startValue,
    progress,
    direction,
    requiredRatePerWeek,
    actualRatePerWeek,
    daysRemaining,
    status,
  };
}

// formatRate lives in ./goal-format (re-exported above) so client
// components can import it without pulling db into their bundle.
