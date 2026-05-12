import { getAllHistory } from "./metric-history";
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

export async function computeGoalProgress(goal: GoalSummary, userId: number): Promise<GoalProgress> {
  const now = Date.now();
  const deadlineTs = new Date(goal.deadline).getTime();
  const daysRemaining = Math.max(0, Math.ceil((deadlineTs - now) / MS_PER_DAY));
  const weeksRemaining = daysRemaining / 7;

  // Read once through metric-history. That layer transparently unions the
  // primitive `metrics` table with workout_sets fanout and computed
  // metrics (e.g. bench_press_max). Goal-calc no longer needs to know
  // where samples come from — any metric_type that has a Series is
  // goal-targetable. Series.samples is sorted ASC by date.
  const series = await getAllHistory(goal.metricName, userId);
  const samples = series.samples;

  const fourWeeksAgo = new Date(now - 4 * MS_PER_WEEK).toISOString();
  // goal.createdAt: ISO timestamp on Postgres (post-multi-user). The
  // legacy SQLite format ("YYYY-MM-DD HH:MM:SS") is still tolerated for
  // any goal rows that haven't been touched since the cutover.
  const createdAtIso = goal.createdAt.includes("T")
    ? goal.createdAt
    : goal.createdAt.replace(" ", "T") + "Z";

  const currentValue = samples.length > 0 ? samples[samples.length - 1].value : null;
  // Start value: the metric value at the moment the goal was created.
  // Iteratively: the most recent sample on or before `createdAt`
  // (samples is ASC, so walk backwards to find it). If the goal
  // pre-dates every sample for this metric, fall back to the first
  // sample after createdAt — the user's first measurement under the
  // goal. NO fallback to "earliest sample overall" — that was the
  // source of the "progress bar treats zero as start" bug: an ancient
  // near-zero reading would anchor the baseline far below the real
  // starting point, inflating progress.
  let valueAtCreate: { value: number } | undefined;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].date <= createdAtIso) {
      valueAtCreate = samples[i];
      break;
    }
  }
  const firstAfterCreate = samples.find((s) => s.date >= createdAtIso);
  const startValue = valueAtCreate?.value ?? firstAfterCreate?.value ?? null;
  const recentRows = samples.filter((s) => s.date >= fourWeeksAgo);

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

  // Actual rate: linear regression over the last 4 weeks (filtered above).
  const recent = recentRows.map((r) => ({
    t: new Date(r.date).getTime(),
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
