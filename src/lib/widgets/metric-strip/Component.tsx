import { MetricsStrip } from "@/components/metrics-strip";
import { isDataDepError, type WidgetData } from "../types";
import { cellKey } from "./keys";
import type { MetricStripConfig, MetricStripCell } from "./schema";

interface LatestRow {
  value: number;
  unit: string;
  recordedAt: string;
}

interface FormattedCell {
  label: string;
  value: string;
  delta: string;
  status: "up" | "down" | "flat";
}

export function MetricStripComponent({
  config,
  data,
}: {
  config: MetricStripConfig;
  data: WidgetData;
}) {
  if (config.metrics.length === 0) {
    return (
      <div className="border border-border border-dashed rounded p-4 text-center text-[0.875rem] text-muted">
        No cells yet. Open the gear to add some.
      </div>
    );
  }
  const cells = config.metrics.map((cell) => {
    const raw = data.get(cellKey(cell));
    return formatCell(cell, isDataDepError(raw) ? null : raw);
  });
  return <MetricsStrip metrics={cells} />;
}

function formatCell(cell: MetricStripCell, raw: unknown): FormattedCell {
  if (cell.mode === "latest") {
    const r = raw as LatestRow | null;
    if (!r) return empty(cell);
    const formatted = formatValue(r.value, cell.format);
    // No explicit cell.unit → DB unit goes into delta (legacy "weight" pattern).
    // cell.unit set → it's appended to value, delta gets cell.delta or "latest".
    if (cell.unit === undefined) {
      return { label: cell.label, value: formatted, delta: r.unit, status: "flat" };
    }
    return {
      label: cell.label,
      value: formatted + cell.unit,
      delta: cell.delta ?? "latest",
      status: "flat",
    };
  }

  if (cell.mode === "avg7") {
    const v = raw as number | null;
    if (v === null || v === undefined) return empty(cell);
    return {
      label: cell.label,
      value: formatValue(v, cell.format) + (cell.unit ?? ""),
      delta: cell.delta ?? "7-day avg",
      status: thresholdStatus(cell.metric, v),
    };
  }

  // raw mode: missing data is distinct from a real zero. sessions_this_week
  // is the only widget-driven raw metric today; if its dep failed entirely
  // we want the empty state, not a misleading "0 this week".
  if (raw === null || raw === undefined) return empty(cell);
  const v = raw as number;
  return {
    label: cell.label,
    value: String(v) + (cell.unit ?? ""),
    delta: cell.delta ?? (cell.metric === "sessions_this_week" ? "this week" : ""),
    status: v > 0 ? "up" : "flat",
  };
}

function empty(cell: MetricStripCell): FormattedCell {
  return { label: cell.label, value: "-", delta: "no data", status: "flat" };
}

function formatValue(v: number, format: MetricStripCell["format"]): string {
  if (format === "int") return Math.round(v).toString();
  if (format === "hours") return `${v.toFixed(1)}h`;
  return v.toFixed(1);
}

/**
 * Mirrors the heuristic in src/app/page.tsx (sleep < 7h is "down"). Kept
 * intentionally minimal; richer per-metric thresholds belong in a future
 * threshold config table, not here.
 */
function thresholdStatus(metric: string, v: number): "up" | "down" | "flat" {
  if (metric === "sleep_hours") return v < 7 ? "down" : "up";
  return "flat";
}
