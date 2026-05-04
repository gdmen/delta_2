"use client";

import { SportsMergeModal } from "./merge-modal";
import { formatShort } from "@/lib/format";
import { SelectableDataTable } from "@/components/selectable-data-table";

interface SportRow {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  focusCount: number;
  goalCount: number;
  lastEventAt: string | null;
}

export function SportsTable({ rows }: { rows: SportRow[] }) {
  return (
    <SelectableDataTable
      rows={rows}
      getKey={(r) => r.id}
      filterTextFn={(r) => r.name}
      filterPlaceholder="Filter sports..."
      itemLabel={{ one: "sport", many: "sports" }}
      emptyState={(q) =>
        q ? `No sports match "${q}".` : "No sports yet."
      }
      columns={[
        {
          header: "Sport",
          className: "font-mono",
          render: (r) => (
            <>
              <span
                className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                style={{ backgroundColor: r.color }}
              />
              {r.name}
            </>
          ),
        },
        {
          header: "Events",
          width: "w-20",
          align: "right",
          className: "font-mono tabular-nums",
          render: (r) => r.eventCount.toLocaleString(),
        },
        {
          header: "Focuses",
          width: "w-20",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => r.focusCount.toLocaleString(),
        },
        {
          header: "Goals",
          width: "w-16",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => r.goalCount.toLocaleString(),
        },
        {
          header: "Last event",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => (r.lastEventAt ? formatShort(r.lastEventAt) : "-"),
        },
      ]}
      renderMergeModal={({ selectedRows, onClose }) => (
        <SportsMergeModal
          candidates={selectedRows.map((r) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            eventCount: r.eventCount,
            focusCount: r.focusCount,
            goalCount: r.goalCount,
          }))}
          onClose={onClose}
        />
      )}
    />
  );
}
