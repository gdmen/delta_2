/**
 * Pure formatting helper extracted from goal-calc.ts so client components
 * can import it without pulling `db` (and through it, better-sqlite3 and
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
