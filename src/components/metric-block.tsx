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
  headline = "latest",
  xMin,
  xMax,
  shareMode = false,
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
  /** "latest" = last sample value + first→last delta (default). "avg" = mean
   * of all samples in `series`. Pick "avg" for windowed compliance dashboards
   * (sleep avg this week). The window itself is conveyed by the chart's
   * x-axis below — the headline group intentionally doesn't repeat it. */
  headline?: "latest" | "avg";
  /** Shared X-axis range, in epoch ms — for aligning multiple blocks. */
  xMin?: number;
  xMax?: number;
  /** True when rendered inside a /share/<token> page. Suppresses the
   * title→metric-detail Link (that page is private to the owner and
   * just redirects share viewers to /signin). The widget data layer
   * already reads the OWNER's data in share mode; this prop only
   * controls the in-header navigation affordance. */
  shareMode?: boolean;
}) {
  const unit = series.unit;
  const target = series.target ?? undefined;
  const higherIsBetter = series.higherIsBetter;
  const decimals = unit === "g/cm²" ? 3 : 1;
  const latest = series.samples[series.samples.length - 1]?.value;
  const first = series.samples[0]?.value;
  const delta = latest !== undefined && first !== undefined ? latest - first : null;

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
    <div className="@container/metric-block">
      {/*
       * Header layout:
       *
       *   line 1   [LABEL] [value] [avg|delta]      [target]
       *
       * The label, primary value, and avg/delta indicator form one
       * inseparable headline group on the left. Target lives in its
       * own flex child on the right.
       *
       * Wrapping behavior is driven by a CONTAINER QUERY on this
       * block's own width, not by per-row flex-wrap that responds to
       * the row's content. That matters when several blocks share a
       * grid: at the same container width they ALL wrap together,
       * not whichever ones have the longest content. A 28rem
       * threshold (covers "WATER 100.6fl_oz_us avg" + a target pill
       * with comfortable gap) keeps the headline single-line at
       * desktop column widths and drops target to its own line at
       * mobile + narrow editor columns.
       *
       *   wide   (>= 28rem):   [LABEL] [value] [avg]    [target]
       *   narrow (< 28rem):    [LABEL] [value] [avg]
       *                        [target]
       */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <div className="flex items-baseline gap-x-3 min-w-0">
          <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            {/*
             * Inside a /share/<token> render, the title stays plain
             * text — the metric-detail page it would otherwise link to
             * is private to the owner. Share-link viewers clicking it
             * would just hit the proxy's /signin redirect.
             */}
            {metricName && !shareMode ? (
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
          {hasData &&
            (headline === "avg" ? (
              <span className="font-mono text-[0.75rem] text-muted">avg</span>
            ) : (
              delta !== null &&
              series.samples.length > 1 && (
                <span
                  className={`font-mono text-[0.75rem] ${
                    delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"
                  }`}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(decimals)}
                </span>
              )
            ))}
        </div>
        {hasData && target !== undefined && (
          <span className="font-mono text-[0.75rem] text-muted @max-[28rem]/metric-block:basis-full">
            target {target}
            {unit}
          </span>
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
