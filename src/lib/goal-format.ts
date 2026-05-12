/**
 * Pure formatting helper extracted from goal-calc.ts so client components
 * can import it without pulling `db` (and through it, postgres-js and
 * the rest of the server-only ingest stack) into the client bundle.
 *
 * goal-calc.ts re-exports this for server callers, so existing imports
 * keep working unchanged.
 */
export function formatRate(rate: number | null, unit: string): string {
  if (rate === null || !Number.isFinite(rate)) return "-";
  const sign = rate > 0 ? "+" : "";
  const abs = Math.abs(rate);
  // Use 2 decimals if small, 1 if medium, 0 if large.
  const decimals = abs < 1 ? 2 : abs < 10 ? 1 : 0;
  return `${sign}${rate.toFixed(decimals)} ${unit}/wk`;
}

/** Derive the default fallback label when no custom name is set. */
export function defaultGoalLabel(g: { metricName: string; targetValue: number; metricUnit: string }): string {
  return `${g.metricName} ${g.targetValue}${g.metricUnit}`;
}

/** Pick the custom name if set, else fall back to the derived label. */
export function displayGoalName(g: { name: string | null; metricName: string; targetValue: number; metricUnit: string }): string {
  return g.name?.trim() || defaultGoalLabel(g);
}

export interface GoalProgress {
  currentValue: number | null;
  startValue: number | null;
  progress: number;
  direction: "up" | "down";
  requiredRatePerWeek: number | null;
  actualRatePerWeek: number | null;
  daysRemaining: number;
  status: "complete" | "on-track" | "behind" | "critical" | "insufficient-data";
}
