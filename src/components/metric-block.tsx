import Link from "next/link";
import { MetricTrend } from "@/components/metric-trend";
import type { Series } from "@/lib/metric-history";

/**
 * Renders one titled metric series: headline latest value + delta vs first
 * sample, optional target line, and a MetricTrend chart below.
 */
export function MetricBlock({
  title,
  metricName,
  series,
  window,
  headline = "latest",
  xMin,
  xMax,
}: {
  title: string;
  /** Underlying metric_type name. When set, the title becomes a link to
   * `/data/metrics/<name>` — the in-context entry point for editing the
   * target + direction (single source of truth). Optional so non-widget
   * callers (e.g., the goal detail page) can render without one. */
  metricName?: string;
  /** Series carries unit + target + higherIsBetter (sourced from
   * metric_types). Widgets pass it through unchanged. */
  series: Series;
  /** Human label for the delta window, e.g. "30d". Defaults to "all time". */
  window?: string;
  /** "latest" = last sample value + first→last delta (default). "avg" = mean
   * of all samples in `series`. Pick "avg" for windowed compliance dashboards
   * (sleep avg this week). */
  headline?: "latest" | "avg";
  /** Shared X-axis range, in epoch ms — for aligning multiple blocks. */
  xMin?: number;
  xMax?: number;
}) {
  const unit = series.unit;
  const target = series.target ?? undefined;
  const higherIsBetter = series.higherIsBetter;
  const decimals = unit === "g/cm²" ? 3 : 1;
  const latest = series.samples[series.samples.length - 1]?.value;
  const first = series.samples[0]?.value;
  const delta = latest !== undefined && first !== undefined ? latest - first : null;
  const deltaLabel = window ?? "all time";

  const avg =
    series.samples.length > 0
      ? series.samples.reduce((s, p) => s + p.value, 0) / series.samples.length
      : undefined;

  const headlineValue = headline === "avg" ? avg : latest;
  const hasData = headlineValue !== undefined;

  // Compliance ratio drives the headline color.
  // higherIsBetter: ratio = value / target, ≥1 green, ≥0.8 orange, <0.8 red.
  // higherIsBetter=false: ratio = target / value, same buckets (target = ceiling).
  // No target set → no color, just neutral foreground.
  const ratio =
    target !== undefined && target > 0 && hasData
      ? higherIsBetter
        ? headlineValue / target
        : headlineValue > 0
          ? target / headlineValue
          : Infinity
      : null;
  const headlineColor =
    ratio === null
      ? ""
      : ratio >= 1
        ? "text-accent-green"
        : ratio >= 0.8
          ? "text-accent-orange"
          : "text-accent-red";

  return (
    <div>
      {/*
       * Header layout: the label + primary value form one group
       * pinned to the left/right ends of the top line; metadata pills
       * (delta-vs-window, target) live in a separate flex group that
       * wraps below the headline group when the widget is narrow.
       *
       * The `flex-wrap` is on the OUTER container so the metadata
       * group as a whole drops to a second line, but the label+value
       * inside the headline group are non-wrappable — they stay
       * glued ("WATER 100.6fl_oz_us" never breaks across lines).
       */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <div className="flex items-baseline gap-x-3 min-w-0">
          <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            {metricName ? (
              <Link
                href={`/data/metrics/${encodeURIComponent(metricName)}`}
                className="hover:text-foreground"
                title="Edit metric (target, direction, history)"
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {hasData ? (
            <span className={`font-mono text-[1.25rem] font-medium ${headlineColor}`}>
              {headlineValue.toFixed(decimals)}
              {unit}
            </span>
          ) : (
            <span className="font-mono text-[0.875rem] text-muted">No data</span>
          )}
        </div>
        {hasData && (
          <div className="flex items-baseline gap-3">
            {headline === "avg" ? (
              <span className="font-mono text-[0.75rem] text-muted">
                {window ?? "all time"} avg
              </span>
            ) : (
              delta !== null &&
              series.samples.length > 1 && (
                <span
                  className={`font-mono text-[0.75rem] ${
                    delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"
                  }`}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(decimals)} / {deltaLabel}
                </span>
              )
            )}
            {target !== undefined && (
              <span className="font-mono text-[0.75rem] text-muted">
                target {target}
                {unit}
              </span>
            )}
          </div>
        )}
      </div>
      <MetricTrend
        samples={series.samples}
        unit={unit}
        target={target}
        height="11rem"
        xMin={xMin}
        xMax={xMax}
      />
    </div>
  );
}
