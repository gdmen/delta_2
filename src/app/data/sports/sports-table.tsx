"use client";

import { SportsMergeModal } from "./merge-modal";
import { formatShort } from "@/lib/format";
import { SelectableDataTable } from "@/components/selectable-data-table";
import { deleteSportsBulk } from "@/lib/data-table/bulk-delete";

interface SportRow {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  focusCount: number;
  goalCount: number;
  lastEventAt: string | null;
  /** True when the name carries a `<source>:` prefix from auto-import. */
  isOrphan: boolean;
  /**
   * Existing canonical sport whose name matches this orphan's suffix
   * (case-insensitive). Rendered inline as a "→ canonical" hint so the
   * user can spot likely merges without scanning the whole table.
   */
  suggestedTarget: { id: number; name: string } | null;
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
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-block w-2 h-2 rounded-full align-middle shrink-0"
                style={{ backgroundColor: r.color }}
              />
              <span>{r.name}</span>
              {r.isOrphan && (
                <span
                  className="font-mono text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-orange/40 text-accent-orange"
                  title="Auto-created on import. Merge into a canonical sport."
                >
                  auto
                </span>
              )}
              {r.suggestedTarget && (
                <span className="text-[0.6875rem] text-muted">
                  → suggests{" "}
                  <span className="text-foreground">
                    {r.suggestedTarget.name}
                  </span>
                </span>
              )}
            </div>
          ),
          sortBy: (r) => r.name.toLowerCase(),
        },
        {
          header: "Events",
          width: "w-20",
          align: "right",
          className: "font-mono tabular-nums",
          render: (r) => r.eventCount.toLocaleString(),
          sortBy: (r) => r.eventCount,
        },
        {
          header: "Focuses",
          width: "w-20",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => r.focusCount.toLocaleString(),
          sortBy: (r) => r.focusCount,
        },
        {
          header: "Goals",
          width: "w-16",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => r.goalCount.toLocaleString(),
          sortBy: (r) => r.goalCount,
        },
        {
          header: "Last event",
          width: "w-40",
          align: "right",
          className: "font-mono tabular-nums text-muted",
          render: (r) => (r.lastEventAt ? formatShort(r.lastEventAt) : "-"),
          sortBy: (r) => r.lastEventAt,
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
      onBulkDelete={(selectedRows) =>
        deleteSportsBulk(selectedRows, (r) => r.id, (r) => r.name)
      }
    />
  );
}
