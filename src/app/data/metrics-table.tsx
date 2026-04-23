"use client";

import { MergeModal } from "./merge-modal";
import { formatShort } from "@/lib/format";
import { SelectableDataTable } from "@/components/selectable-data-table";

interface MetricTypeRow {
  id: number;
  name: string;
  unit: string;
  count: number;
  lastAt: string | null;
}

export function MetricsTable({ rows }: { rows: MetricTypeRow[] }) {
  return (
    <SelectableDataTable
      rows={rows}
      getKey={(r) => r.id}
      filterTextFn={(r) => r.name}
      filterPlaceholder="Filter metrics..."
      itemLabel={{ one: "metric", many: "metrics" }}
      emptyState={(q) => (q ? `No metrics match "${q}".` : "No metrics.")}
      rowHref={(r) => `/data/metrics/${encodeURIComponent(r.name)}`}
      rowHrefAriaLabel={(r) => `Open ${r.name}`}
      columns={[
        {
          header: "Metric",
          className: "font-mono",
          render: (t) => (
            <>
              {t.name}
              {t.unit && <span className="text-muted"> ({t.unit})</span>}
            </>
          ),
        },
        {
          header: "Rows",
          width: "w-24",
          align: "right",
          className: "font-mono tabular-nums",
          render: (t) => t.count.toLocaleString(),
        },
        {
          header: "Last",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (t) => (t.lastAt ? formatShort(t.lastAt) : "-"),
        },
      ]}
      renderMergeModal={({ selectedRows, onClose }) => (
        <MergeModal
          candidates={selectedRows.map((r) => ({
            id: r.id,
            name: r.name,
            unit: r.unit,
            count: r.count,
          }))}
          onClose={onClose}
        />
      )}
    />
  );
}
