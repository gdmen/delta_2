import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, gte, desc, asc } from "drizzle-orm";

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

export interface GoalProgress {
  currentValue: number | null;
  startValue: number | null; // earliest sample at or after goal was created
  progress: number;          // 0-100, signed so it caps at 100 when complete
  direction: "up" | "down";  // up means target > start; down means target < start
  requiredRatePerWeek: number | null; // value-delta per week needed from today to deadline
  actualRatePerWeek: number | null;   // value-delta per week observed (last 4 weeks, linear regression)
  daysRemaining: number;
  status: "complete" | "on-track" | "behind" | "critical" | "insufficient-data";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / MS_PER_DAY));
}

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

  // Pull all samples for this metric type, ordered newest first.
  // In practice this is bounded (hundreds of rows at most).
  const latestRows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.id, goal.metricTypeId))
    .orderBy(desc(metrics.recordedAt))
    .limit(1);

  const currentValue = latestRows[0]?.value ?? null;

  // Start value: first sample on or after goal creation (so we measure progress since the goal was set).
  const startRows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      eq(metricTypes.id, goal.metricTypeId)
    )
    .orderBy(asc(metrics.recordedAt))
    .limit(200);

  // Take the first sample at or after createdAt, fall back to earliest sample overall.
  const createdAt = new Date(goal.createdAt).getTime();
  const afterCreate = startRows.find((r) => new Date(r.recordedAt).getTime() >= createdAt);
  const startValue = afterCreate?.value ?? startRows[0]?.value ?? null;

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

  // Actual rate: linear regression over last 4 weeks.
  const fourWeeksAgo = new Date(now - 4 * MS_PER_WEEK).toISOString();
  const recentRows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      eq(metricTypes.id, goal.metricTypeId)
    )
    .orderBy(asc(metrics.recordedAt));

  const recent = recentRows
    .filter((r) => r.recordedAt >= fourWeeksAgo)
    .map((r) => ({ t: new Date(r.recordedAt).getTime(), v: r.value }));

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

export function formatRate(rate: number | null, unit: string): string {
  if (rate === null || !Number.isFinite(rate)) return "-";
  const sign = rate > 0 ? "+" : "";
  const abs = Math.abs(rate);
  // Use 2 decimals if small, 1 if medium, 0 if large.
  const decimals = abs < 1 ? 2 : abs < 10 ? 1 : 0;
  return `${sign}${rate.toFixed(decimals)} ${unit}/wk`;
}
