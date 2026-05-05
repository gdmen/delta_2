"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

interface Sample {
  date: string;
  value: number;
}

export function MetricTrend({
  samples,
  unit,
  target,
  color = "#171717",
  height = "12rem",
  xMin,
  xMax,
}: {
  samples: Sample[];
  unit: string;
  target?: number;
  color?: string;
  /** CSS height — pass rem so charts scale with text zoom. Recharts'
   * ResponsiveContainer accepts strings as raw CSS values. */
  height?: string;
  /** Lock the X-axis to this range (epoch ms). Lets a parent align several
   * charts to the same time window so they're visually comparable. */
  xMin?: number;
  xMax?: number;
}) {
  const empty = samples.length === 0;
  if (empty && xMin === undefined) {
    return (
      <div
        className="border border-border rounded flex items-center justify-center text-[0.875rem] text-muted"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  // Per-rep synthesized data (workout_sets fanout in metric-history) can hit
  // a few thousand samples sharing per-set timestamps — Recharts will render
  // each as a separate SVG element and Firefox stalls past ~3K. Above the
  // threshold we collapse to one point per day with the day's max value,
  // which is also a more informative chart shape (peak lift per day) than a
  // cloud of identical points. Below the threshold, the input is rendered
  // verbatim — small daily-cadence metrics (sleep, weight) are unaffected.
  const HEAVY_THRESHOLD = 365;
  const collapsed =
    samples.length > HEAVY_THRESHOLD
      ? collapseToDailyMax(samples)
      : samples;

  const data = collapsed.map((s) => ({
    ts: new Date(s.date).getTime(),
    value: s.value,
  }));

  const dataMin = data.length > 0 ? data[0].ts : (xMin ?? 0);
  const dataMax = data.length > 0 ? data[data.length - 1].ts : (xMax ?? 0);
  const minTs = xMin ?? dataMin;
  const maxTs = xMax ?? dataMax;
  const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);

  // Pick an axis label format based on the time range.
  // - ≤ 60 days: MM-DD (e.g. "04-16") - year is redundant in short windows
  // - ≤ 2 years: YYYY-MM - year + month matters when spanning months
  // - > 2 years: YYYY - anything denser is noise at this scale
  const formatTick = (ts: number): string => {
    const iso = new Date(ts).toISOString();
    if (spanDays <= 60) return iso.slice(5, 10);
    if (spanDays <= 365 * 2) return iso.slice(0, 7);
    return iso.slice(0, 4);
  };

  const formatTooltipLabel = (ts: number): string => {
    return new Date(ts).toISOString().slice(0, 10);
  };

  // Generate clean calendar-aligned ticks (Jan 1 of each year, 1st of each
  // month, etc.) rather than letting Recharts pick arbitrary timestamps between
  // the data extremes. Ticks don't need to align with sample points - they're
  // just axis labels. Empty array = fall back to auto.
  const ticks = generateCalendarTicks(minTs, maxTs, spanDays);

  // The wrapper carries the rem height so the chart scales with text zoom;
  // ResponsiveContainer fills that wrapper (recharts' calculateChartDimensions
  // does Number(height) on non-percent strings, which would NaN out a "rem" value
  // and silently render nothing — hence the 100% indirection).
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#f5f5f5" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[minTs, maxTs]}
            scale="time"
            tick={{ fontSize: 11, fill: "#a3a3a3", fontFamily: "JetBrains Mono" }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
            tickFormatter={formatTick}
            minTickGap={24}
            {...(ticks.length > 0 ? { ticks } : {})}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a3a3a3", fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
            domain={["dataMin - 1", "dataMax + 1"]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
            }}
            formatter={(v) => [`${typeof v === "number" ? v.toFixed(1) : v} ${unit}`, ""]}
            labelFormatter={(label) => formatTooltipLabel(Number(label))}
          />
          {target !== undefined && (
            <ReferenceLine y={target} stroke="#f97316" strokeDasharray="3 3" />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            // Dots are decorative on dense series and dominate render cost
            // (one SVG circle per point). Drop them above the heavy
            // threshold; keep the small per-point dots on sparse series
            // where they read as data marks.
            dot={data.length > HEAVY_THRESHOLD ? false : { r: 2, fill: color }}
            activeDot={{ r: 4 }}
            // Animation cost scales with the number of segments. Off
            // unconditionally — animating a dashboard chart is jarring
            // anyway; the page already loaded, the line should just be
            // there.
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Walk the (already date-sorted) sample array and emit one row per
 * calendar day with that day's max value. Used as a decimation pass for
 * dense / per-rep series before handing them to Recharts. O(n), one
 * allocation per distinct day.
 */
function collapseToDailyMax(
  samples: Sample[],
): Sample[] {
  const out: Sample[] = [];
  let currentDay = "";
  let currentMax = -Infinity;
  let currentRepresentative = "";
  for (const s of samples) {
    const day = s.date.slice(0, 10);
    if (day !== currentDay) {
      if (currentDay) out.push({ date: currentRepresentative, value: currentMax });
      currentDay = day;
      currentMax = s.value;
      currentRepresentative = s.date;
    } else if (s.value > currentMax) {
      currentMax = s.value;
      currentRepresentative = s.date;
    }
  }
  if (currentDay) out.push({ date: currentRepresentative, value: currentMax });
  return out;
}

/**
 * Produce calendar-aligned tick positions for a time axis - Jan 1 of each year,
 * 1st of each month, Mondays, or midnights, depending on span. Returned ticks
 * are clamped to [minTs, maxTs]. Empty return = let Recharts auto-pick.
 *
 * Density targets: aim for roughly 4-10 labels visible. `minTickGap` on the
 * XAxis still culls overlapping ones if the chart is narrow.
 */
function generateCalendarTicks(minTs: number, maxTs: number, spanDays: number): number[] {
  if (spanDays <= 0 || !Number.isFinite(spanDays)) return [];

  const ticks: number[] = [];
  const push = (ts: number) => {
    if (ts >= minTs && ts <= maxTs) ticks.push(ts);
  };

  if (spanDays > 365 * 2) {
    // Yearly ticks (Jan 1 UTC). Subsample if range is very long.
    const startYear = new Date(minTs).getUTCFullYear();
    const endYear = new Date(maxTs).getUTCFullYear();
    const totalYears = endYear - startYear;
    const step = totalYears > 20 ? 5 : totalYears > 10 ? 2 : 1;
    for (let y = startYear; y <= endYear + 1; y++) {
      if ((y - startYear) % step === 0) push(Date.UTC(y, 0, 1));
    }
  } else if (spanDays > 60) {
    // Monthly ticks (1st UTC). Subsample if >12 months.
    const start = new Date(minTs);
    const totalMonths = Math.ceil(spanDays / 30);
    const step = totalMonths > 24 ? 3 : totalMonths > 12 ? 2 : 1;
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    let count = 0;
    while (Date.UTC(y, m, 1) <= maxTs) {
      if (count % step === 0) push(Date.UTC(y, m, 1));
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
      count++;
    }
  } else if (spanDays > 14) {
    // Weekly ticks at the Monday UTC on or after minTs.
    const d = new Date(minTs);
    d.setUTCHours(0, 0, 0, 0);
    const dow = d.getUTCDay();
    const daysToMonday = dow === 0 ? 1 : (8 - dow) % 7;
    d.setUTCDate(d.getUTCDate() + daysToMonday);
    while (d.getTime() <= maxTs) {
      push(d.getTime());
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else if (spanDays > 2) {
    // Daily ticks at midnight UTC.
    const d = new Date(minTs);
    d.setUTCHours(0, 0, 0, 0);
    // Start at first midnight >= minTs
    if (d.getTime() < minTs) d.setUTCDate(d.getUTCDate() + 1);
    while (d.getTime() <= maxTs) {
      push(d.getTime());
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  // <2 days: fall through to auto - Recharts handles sub-day better.

  return ticks;
}
