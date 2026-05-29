import { db } from "@/db";
import { metrics, metricTypes, events, activities, workoutSets } from "@/db/schema";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { classifyLift, oconnorE1RM, type Lift } from "@/lib/strength-metrics";
import { userScope } from "@/lib/auth/scope";

export interface DailySummary {
  date: string;
  metrics: Record<string, { avg: number; min: number; max: number; count: number; unit: string }>;
  events: Array<{ activity: string; type: string; durationMinutes: number | null }>;
}

/**
 * Generate daily summaries for a date range. Checks the daily_summaries cache first;
 * if cache is missing or stale (dirty via lastIngestAt), recomputes from metrics table.
 *
 * Returns one DailySummary per day in range, newest first.
 */
export async function getDailySummaries(startDate: string, endDate: string, userId: number): Promise<DailySummary[]> {
  const allMetricTypes = await db
    .select()
    .from(metricTypes)
    .where(userScope(userId).metricTypes);
  const mtById = new Map(allMetricTypes.map((mt) => [mt.id, mt]));

  // Pull raw metrics for the range (small dataset for a 7-14 day window).
  const rawMetrics = await db
    .select({
      metricTypeId: metrics.metricTypeId,
      value: metrics.value,
      recordedAt: metrics.recordedAt,
    })
    .from(metrics)
    .where(
      and(
        userScope(userId).metrics,
        gte(metrics.recordedAt, startDate),
        lte(metrics.recordedAt, `${endDate}T23:59:59Z`),
      ),
    );

  // Pull events for the range.
  const rawEvents = await db
    .select({
      activityName: activities.name,
      type: events.type,
      durationMinutes: events.durationMinutes,
      startedAt: events.startedAt,
    })
    .from(events)
    .innerJoin(activities, eq(events.activityId, activities.id))
    .where(
      and(
        userScope(userId).events,
        gte(events.startedAt, startDate),
        lte(events.startedAt, `${endDate}T23:59:59Z`),
      ),
    );

  // Group by date.
  const dayMap = new Map<string, DailySummary>();

  const ensureDay = (date: string): DailySummary => {
    let day = dayMap.get(date);
    if (!day) {
      day = { date, metrics: {}, events: [] };
      dayMap.set(date, day);
    }
    return day;
  };

  for (const m of rawMetrics) {
    const date = m.recordedAt.slice(0, 10);
    const day = ensureDay(date);
    const mt = mtById.get(m.metricTypeId);
    if (!mt) continue;

    const existing = day.metrics[mt.name];
    if (!existing) {
      day.metrics[mt.name] = { avg: m.value, min: m.value, max: m.value, count: 1, unit: mt.unit };
    } else {
      existing.avg = (existing.avg * existing.count + m.value) / (existing.count + 1);
      existing.min = Math.min(existing.min, m.value);
      existing.max = Math.max(existing.max, m.value);
      existing.count++;
    }
  }

  for (const e of rawEvents) {
    const date = e.startedAt.slice(0, 10);
    const day = ensureDay(date);
    day.events.push({
      activity: e.activityName,
      type: e.type,
      durationMinutes: e.durationMinutes,
    });
  }

  return Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// V1 derived signals (locked in CEO plan 2026-04-28). These feed the LLM
// prompt for suggest-focuses / summarize-period / close-focus verdict.
// Definitions are deliberately conservative — better to fire on a real
// plateau and miss a marginal one than to fire on noise.
// ---------------------------------------------------------------------------

const RECOVERY_BASELINE_DAYS = 90;
const ROLLING_SHORT_DAYS = 7;
const ROLLING_LONG_DAYS = 28;
const ROLLING_MIN_READINGS = 14; // require this many in the long window
const RECENT_PR_WINDOW_DAYS = 84; // 12 weeks — current capacity, not lifetime peak

const RECOVERY_METRICS_WEIGHTS: Record<string, number> = {
  sleep_hours: 0.4,
  hrv_ms: 0.3,
  protein_g: 0.3,
};

export interface PlateauSignal {
  lift: Lift;
  weeksSinceLastPr: number;
  lastPrDate: string | null; // YYYY-MM-DD — all-time peak
  lastPrValue: number | null; // e1RM at the all-time peak
  /**
   * Best e1RM in the last `RECENT_PR_WINDOW_DAYS`. May be lower than the
   * all-time PR (athlete weaker than peak — common after a layoff, weight
   * cut, injury, or activity-balance reshuffle). Goals are typically benchmarked
   * against this, NOT the lifetime peak.
   */
  recentBestValue: number | null;
  recentBestDate: string | null;
  recentBestWindowDays: number;
  unit: string;
}

export interface RollingAverageSignal {
  metric: string;
  unit: string;
  avg7: number;
  avg28: number;
  delta: number; // avg7 - avg28
  readingsInLongWindow: number;
}

export interface RecoveryDebtSignal {
  score: number; // weighted z-score, higher = more debt
  breakdown: Record<string, { z: number; recent: number; baseline: number; weight: number }>;
  baselineWindowDays: number;
  alarmThreshold: number;
  insufficientData: boolean; // true if no recovery component had enough data
}

export interface VolumeTrendSignal {
  activity: string;
  deltaPct: number; // (current - baseline) / baseline * 100
  baselineTonnage: number; // 90-day average
  currentTonnage: number; // 28-day total
  insufficientData: boolean;
}

/**
 * Plateau detection per Big-3 lift. Returns weeks-since-last-PR per lift
 * so the caller can apply its own threshold. One signal per lift, ordered
 * squat → bench → deadlift. Lifts with zero historical sets return
 * `lastPrDate: null` so the LLM knows to ignore them rather than reporting
 * a fake plateau.
 */
export async function getPlateauSignals(userId: number): Promise<PlateauSignal[]> {
  // Pull every powerlifting set in history. Dataset is bounded (low thousands
  // for an active trainee), in-memory classification + max-tracking is fast.
  // INHERIT scoping: workout_sets has no user_id; restrict via
  // events.user_id and metric_types.user_id.
  const rows = await db
    .select({
      exerciseName: metricTypes.name,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(activities, eq(events.activityId, activities.id))
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .where(
      and(
        userScope(userId).events,
        userScope(userId).metricTypes,
        userScope(userId).activities,
        eq(activities.name, "powerlifting"),
      ),
    )
    .orderBy(desc(events.startedAt));

  type LiftAcc = {
    lastPrDate: string | null;
    lastPrValue: number;
    recentBestDate: string | null;
    recentBestValue: number;
  };
  const perLift: Record<Lift, LiftAcc> = {
    squat: { lastPrDate: null, lastPrValue: 0, recentBestDate: null, recentBestValue: 0 },
    bench: { lastPrDate: null, lastPrValue: 0, recentBestDate: null, recentBestValue: 0 },
    deadlift: {
      lastPrDate: null,
      lastPrValue: 0,
      recentBestDate: null,
      recentBestValue: 0,
    },
  };

  const recentCutoff = Date.now() - RECENT_PR_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const r of rows) {
    const lift = classifyLift(r.exerciseName);
    if (!lift) continue;
    const e1rm = oconnorE1RM(r.weight, r.reps);
    if (e1rm <= 0) continue;
    const acc = perLift[lift];
    if (e1rm > acc.lastPrValue) {
      acc.lastPrValue = e1rm;
      acc.lastPrDate = r.startedAt.slice(0, 10);
    }
    if (new Date(r.startedAt).getTime() >= recentCutoff && e1rm > acc.recentBestValue) {
      acc.recentBestValue = e1rm;
      acc.recentBestDate = r.startedAt.slice(0, 10);
    }
  }

  const now = Date.now();
  const out: PlateauSignal[] = [];
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    const p = perLift[lift];
    if (!p.lastPrDate) {
      out.push({
        lift,
        weeksSinceLastPr: 0,
        lastPrDate: null,
        lastPrValue: null,
        recentBestValue: null,
        recentBestDate: null,
        recentBestWindowDays: RECENT_PR_WINDOW_DAYS,
        unit: "",
      });
      continue;
    }
    const daysSince = (now - new Date(p.lastPrDate).getTime()) / (24 * 60 * 60 * 1000);
    out.push({
      lift,
      weeksSinceLastPr: Math.floor(daysSince / 7),
      lastPrDate: p.lastPrDate,
      lastPrValue: round1(p.lastPrValue),
      recentBestValue: p.recentBestValue > 0 ? round1(p.recentBestValue) : null,
      recentBestDate: p.recentBestDate,
      recentBestWindowDays: RECENT_PR_WINDOW_DAYS,
      // workout_sets.weight has no per-row unit; assume the trainee is
      // consistent in one unit (typically lb or kg). Caller can attach.
      unit: "",
    });
  }
  return out;
}

/**
 * Rolling 7-day vs 28-day mean for daily-frequency metrics. Skips any metric
 * without `ROLLING_MIN_READINGS` in the 28-day window — sparse data produces
 * misleading averages.
 *
 * Pass `metricNames` to scope the computation; defaults to the recovery
 * trinity + bodyweight which are the most universally useful daily signals.
 */
export async function getRollingAverages(
  userId: number,
  metricNames: string[] = ["sleep_hours", "protein_g", "bodyweight", "hrv_ms"],
): Promise<RollingAverageSignal[]> {
  if (metricNames.length === 0) return [];

  const longStart = daysAgo(ROLLING_LONG_DAYS);
  const longEnd = today();

  const rows = await db
    .select({
      name: metricTypes.name,
      unit: metricTypes.unit,
      value: metrics.value,
      recordedAt: metrics.recordedAt,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      and(
        userScope(userId).metrics,
        userScope(userId).metricTypes,
        gte(metrics.recordedAt, longStart),
        lte(metrics.recordedAt, `${longEnd}T23:59:59Z`),
      ),
    );

  const shortCutoff = new Date(daysAgo(ROLLING_SHORT_DAYS)).getTime();

  // Bucket readings per metric name. Filter to the requested set.
  const wanted = new Set(metricNames);
  const perMetric = new Map<
    string,
    { unit: string; long: number[]; short: number[] }
  >();
  for (const r of rows) {
    if (!wanted.has(r.name)) continue;
    let bucket = perMetric.get(r.name);
    if (!bucket) {
      bucket = { unit: r.unit, long: [], short: [] };
      perMetric.set(r.name, bucket);
    }
    bucket.long.push(r.value);
    const ts = new Date(r.recordedAt).getTime();
    if (ts >= shortCutoff) bucket.short.push(r.value);
  }

  const out: RollingAverageSignal[] = [];
  for (const name of metricNames) {
    const b = perMetric.get(name);
    if (!b || b.long.length < ROLLING_MIN_READINGS) continue;
    const avg28 = mean(b.long);
    const avg7 = b.short.length > 0 ? mean(b.short) : avg28;
    out.push({
      metric: name,
      unit: b.unit,
      avg7: round1(avg7),
      avg28: round1(avg28),
      delta: round1(avg7 - avg28),
      readingsInLongWindow: b.long.length,
    });
  }
  return out;
}

/**
 * Recovery-debt z-score over the last 7 days, weighted across sleep / HRV /
 * protein and computed against a 90-day baseline. Higher = more debt.
 *
 * Lower-is-better metrics are NOT in this score (resting_hr is correlated
 * with HRV and would double-count). If a component has fewer than
 * `ROLLING_MIN_READINGS` baseline readings, its weight is dropped from the
 * weighted average and the remaining weights are renormalized — that's
 * better than reporting a NaN or pretending the component contributed.
 *
 * Score interpretation:
 *   |z| < 0.5  : nominal
 *   0.5 ≤ z < 1.0 : mild debt
 *   z ≥ 1.0    : alarm — recovery is materially worse than baseline
 *
 * Sign convention: HIGHER baseline-deviation in a "less is worse" direction
 * (less sleep, lower HRV, less protein) → POSITIVE score. So +1.0 means
 * "1 stddev below baseline on average", not "above."
 */
export async function getRecoveryDebt(userId: number): Promise<RecoveryDebtSignal> {
  const recoveryNames = Object.keys(RECOVERY_METRICS_WEIGHTS);
  const baselineStart = daysAgo(RECOVERY_BASELINE_DAYS);
  const baselineEnd = today();
  const recentCutoff = new Date(daysAgo(ROLLING_SHORT_DAYS)).getTime();

  const rows = await db
    .select({
      name: metricTypes.name,
      value: metrics.value,
      recordedAt: metrics.recordedAt,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      and(
        userScope(userId).metrics,
        userScope(userId).metricTypes,
        gte(metrics.recordedAt, baselineStart),
        lte(metrics.recordedAt, `${baselineEnd}T23:59:59Z`),
      ),
    );

  const perMetric = new Map<string, { all: number[]; recent: number[] }>();
  for (const r of rows) {
    if (!RECOVERY_METRICS_WEIGHTS[r.name]) continue;
    let b = perMetric.get(r.name);
    if (!b) {
      b = { all: [], recent: [] };
      perMetric.set(r.name, b);
    }
    b.all.push(r.value);
    if (new Date(r.recordedAt).getTime() >= recentCutoff) {
      b.recent.push(r.value);
    }
  }

  const breakdown: RecoveryDebtSignal["breakdown"] = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const name of recoveryNames) {
    const b = perMetric.get(name);
    if (!b || b.all.length < ROLLING_MIN_READINGS || b.recent.length === 0) continue;
    const baselineMean = mean(b.all);
    const baselineStd = stdDev(b.all, baselineMean);
    if (baselineStd <= 0) continue; // flat baseline, skip
    const recentMean = mean(b.recent);
    // POSITIVE = below baseline (worse for sleep/hrv/protein → "more debt")
    const z = (baselineMean - recentMean) / baselineStd;
    const w = RECOVERY_METRICS_WEIGHTS[name];
    breakdown[name] = {
      z: round2(z),
      recent: round1(recentMean),
      baseline: round1(baselineMean),
      weight: w,
    };
    weightedSum += z * w;
    weightTotal += w;
  }

  if (weightTotal === 0) {
    return {
      score: 0,
      breakdown,
      baselineWindowDays: RECOVERY_BASELINE_DAYS,
      alarmThreshold: 1.0,
      insufficientData: true,
    };
  }

  return {
    score: round2(weightedSum / weightTotal),
    breakdown,
    baselineWindowDays: RECOVERY_BASELINE_DAYS,
    alarmThreshold: 1.0,
    insufficientData: false,
  };
}

/**
 * Volume trend per activity: 28-day total tonnage compared to a 90-day baseline
 * total scaled to the same window. Positive deltaPct = ramping up, negative =
 * deloading or backing off.
 *
 * Tonnage definition is activity-aware:
 *   - powerlifting: Σ(reps × weight) across all workout_sets
 *   - everything else (BJJ, running, hiking, biking): Σ(duration_minutes)
 *
 * Returns one signal per activity that has data in the long window.
 */
export async function getVolumeTrends(
  userId: number,
  activityNames?: string[],
): Promise<VolumeTrendSignal[]> {
  const baselineStart = daysAgo(90);
  const recentStart = daysAgo(ROLLING_LONG_DAYS);

  // Powerlifting tonnage from workout_sets.
  // INHERIT scoping: workout_sets has no user_id; restrict via
  // events.user_id (also restricts the activities join naturally).
  const setsRows = await db
    .select({
      activity: activities.name,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(activities, eq(events.activityId, activities.id))
    .where(and(userScope(userId).events, gte(events.startedAt, baselineStart)));

  // Other activities: duration_minutes on events.
  const eventRows = await db
    .select({
      activity: activities.name,
      durationMinutes: events.durationMinutes,
      startedAt: events.startedAt,
    })
    .from(events)
    .innerJoin(activities, eq(events.activityId, activities.id))
    .where(and(userScope(userId).events, gte(events.startedAt, baselineStart)));

  type Bucket = { baseline: number; recent: number };
  const tonnage = new Map<string, Bucket>();
  const ensure = (s: string): Bucket => {
    let b = tonnage.get(s);
    if (!b) {
      b = { baseline: 0, recent: 0 };
      tonnage.set(s, b);
    }
    return b;
  };

  const recentCutoff = new Date(recentStart).getTime();

  for (const r of setsRows) {
    if (r.activity !== "powerlifting") continue;
    const t = r.reps * r.weight;
    const ts = new Date(r.startedAt).getTime();
    const b = ensure(r.activity);
    b.baseline += t;
    if (ts >= recentCutoff) b.recent += t;
  }

  for (const r of eventRows) {
    if (r.activity === "powerlifting") continue; // covered by setsRows above
    const dur = r.durationMinutes ?? 0;
    if (dur <= 0) continue;
    const ts = new Date(r.startedAt).getTime();
    const b = ensure(r.activity);
    b.baseline += dur;
    if (ts >= recentCutoff) b.recent += dur;
  }

  const out: VolumeTrendSignal[] = [];
  const activityFilter = activityNames ? new Set(activityNames) : null;
  for (const [activity, b] of tonnage.entries()) {
    if (activityFilter && !activityFilter.has(activity)) continue;
    if (b.baseline <= 0) {
      out.push({
        activity,
        deltaPct: 0,
        baselineTonnage: 0,
        currentTonnage: 0,
        insufficientData: true,
      });
      continue;
    }
    // Scale the 90-day baseline down to a 28-day equivalent so the comparison
    // is apples-to-apples (otherwise the 28d window always looks small).
    const baselineScaled = (b.baseline * ROLLING_LONG_DAYS) / 90;
    const deltaPct =
      baselineScaled > 0 ? ((b.recent - baselineScaled) / baselineScaled) * 100 : 0;
    out.push({
      activity,
      deltaPct: Math.round(deltaPct * 10) / 10,
      baselineTonnage: Math.round(baselineScaled),
      currentTonnage: Math.round(b.recent),
      insufficientData: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stdDev(xs: number[], precomputedMean?: number): number {
  if (xs.length < 2) return 0;
  const m = precomputedMean ?? mean(xs);
  let sumSq = 0;
  for (const x of xs) sumSq += (x - m) * (x - m);
  return Math.sqrt(sumSq / (xs.length - 1));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
