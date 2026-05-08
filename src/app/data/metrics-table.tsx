"use client";

import Link from "next/link";
import { MergeModal } from "./merge-modal";
import { formatShort } from "@/lib/format";
import {
  SelectableDataTable,
  type BulkDeleteResult,
} from "@/components/selectable-data-table";
import { deleteMetricTypesBulk } from "@/lib/data-table/bulk-delete";

interface MetricTypeRow {
  id: number;
  name: string;
  unit: string;
  count: number;
  lastAt: string | null;
}

export function MetricsTable({ rows }: { rows: MetricTypeRow[] }) {
  return (
    <div>
      <div className="flex justify-end mb-2">
        <Link
          href="/input/metric"
          className="px-3 py-1.5 text-[0.8125rem] text-foreground hover:opacity-80 underline"
        >
          + New metric
        </Link>
      </div>
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
          sortBy: (t) => t.name.toLowerCase(),
        },
        {
          header: "Rows",
          width: "w-24",
          align: "right",
          className: "font-mono tabular-nums",
          render: (t) => t.count.toLocaleString(),
          sortBy: (t) => t.count,
        },
        {
          header: "Last",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (t) => (t.lastAt ? formatShort(t.lastAt) : "-"),
          sortBy: (t) => t.lastAt,
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
      onBulkDelete={async (selectedRows): Promise<BulkDeleteResult<MetricTypeRow>> =>
        deleteMetricTypesBulk(selectedRows, (r) => r.id, (r) => r.name)
      }
    />
    </div>
  );
}
