import { MetricTrend } from "@/components/metric-trend";
import type { Series } from "@/lib/metric-history";

/**
 * Renders one titled metric series: headline latest value + delta vs first
 * sample, optional target line, and a MetricTrend chart below.
 */
export function MetricBlock({
  title,
  series,
  fallbackUnit,
  target,
  window,
}: {
  title: string;
  series: Series;
  fallbackUnit: string;
  target?: number;
  /** Human label for the delta window, e.g. "30d". Defaults to "all time". */
  window?: string;
}) {
  const unit = series.unit || fallbackUnit;
  const latest = series.samples[series.samples.length - 1]?.value;
  const first = series.samples[0]?.value;
  const delta = latest !== undefined && first !== undefined ? latest - first : null;
  const deltaLabel = window ?? "all time";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        <div className="flex items-baseline gap-3">
          {latest !== undefined ? (
            <>
              <span className="font-mono text-[1.25rem] font-medium">
                {latest.toFixed(unit === "g/cm²" ? 3 : 1)}
                {unit}
              </span>
              {delta !== null && series.samples.length > 1 && (
                <span
                  className={`font-mono text-[0.75rem] ${
                    delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"
                  }`}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(unit === "g/cm²" ? 3 : 1)} / {deltaLabel}
                </span>
              )}
              {target !== undefined && (
                <span className="font-mono text-[0.75rem] text-muted">
                  target {target}
                  {unit}
                </span>
              )}
            </>
          ) : (
            <span className="font-mono text-[0.875rem] text-muted">No data</span>
          )}
        </div>
      </div>
      <MetricTrend samples={series.samples} unit={unit} target={target} height={180} />
    </div>
  );
}
