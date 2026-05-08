"use client";

import { MergeModal } from "@/app/data/merge-modal";
import { formatShort } from "@/lib/format";
import { SelectableDataTable } from "@/components/selectable-data-table";
import { deleteMetricTypesBulk } from "@/lib/data-table/bulk-delete";

interface ExerciseRow {
  id: number;
  name: string;
  unit: string;
  sets: number;
  eventCount: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function ExercisesTable({ rows }: { rows: ExerciseRow[] }) {
  return (
    <SelectableDataTable
      rows={rows}
      getKey={(r) => r.id}
      filterTextFn={(r) => r.name}
      filterPlaceholder="Filter exercises..."
      itemLabel={{ one: "exercise", many: "exercises" }}
      emptyState={(q) =>
        q
          ? `No exercises match "${q}".`
          : "No exercises yet — import a workout_sets CSV."
      }
      columns={[
        {
          header: "Exercise",
          className: "font-mono",
          render: (r) => r.name,
          sortBy: (r) => r.name.toLowerCase(),
        },
        {
          header: "Sets",
          width: "w-20",
          align: "right",
          className: "font-mono tabular-nums",
          render: (r) => r.sets.toLocaleString(),
          sortBy: (r) => r.sets,
        },
        {
          header: "Events",
          width: "w-24",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => r.eventCount.toLocaleString(),
          sortBy: (r) => r.eventCount,
        },
        {
          header: "First",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => (r.firstAt ? formatShort(r.firstAt) : "-"),
          sortBy: (r) => r.firstAt,
        },
        {
          header: "Last",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => (r.lastAt ? formatShort(r.lastAt) : "-"),
          sortBy: (r) => r.lastAt,
        },
      ]}
      renderMergeModal={({ selectedRows, onClose }) => (
        <MergeModal
          candidates={selectedRows.map((r) => ({
            id: r.id,
            name: r.name,
            unit: r.unit,
            count: r.sets,
          }))}
          onClose={onClose}
        />
      )}
      onBulkDelete={(selectedRows) =>
        deleteMetricTypesBulk(selectedRows, (r) => r.id, (r) => r.name)
      }
    />
  );
}
