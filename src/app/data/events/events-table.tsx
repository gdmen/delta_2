"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatShort } from "@/lib/format";
import { useRowSelection } from "@/components/use-row-selection";
import { SelectAllCheckbox } from "@/components/select-all-checkbox";
import { RowSelectCheckbox } from "@/components/row-select-checkbox";
import {
  CompositeMergeModal,
  type MergeMember,
  type ActivityOption,
} from "@/components/composite-merge-modal";

export interface EventRow {
  id: number;
  startedAt: string;
  activityId: number;
  activityName: string;
  type: string;
  durationMinutes: number | null;
  source: string;
  /** Status restricts what's selectable for merge — only 'visible' rows. */
  status: "visible" | "hidden_by_composite" | "composite";
}

/**
 * Multi-select wrapper around the events table. Checkbox on each row;
 * a floating action bar appears when ≥1 row is selected with a Merge CTA.
 *
 * Selection rules:
 *   - Only `visible` rows can be checked. Composite rows already wrap
 *     other events; merging a composite into another composite isn't a
 *     thing we support (use Unmerge first).
 *   - 1 selected → "Promote to composite" (activity retag).
 *   - 2+ selected → "Merge N → composite". Members may share a source
 *     (e.g. a Garmin and a Whoop both syncing one ride to Strava); the
 *     user picks the composite's canonical activity at merge time.
 */
export function EventsTable({
  rows,
  activityOptions,
  typeSuggestionsByActivityId,
}: {
  rows: EventRow[];
  activityOptions: ActivityOption[];
  typeSuggestionsByActivityId?: Record<number, string[]>;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  // Only `visible` rows are selectable; the shared selection machine is fed
  // those ids in display order, so a shift range skips interleaved disabled
  // (composite / hidden_by_composite) rows. Deriving the working set from
  // the current `rows` also means ids that paginated/filtered out of view
  // simply drop from the count and the merge payload.
  const selectableRows = rows.filter((r) => r.status === "visible");
  const sel = useRowSelection(selectableRows.map((r) => r.id));
  const selectedRows = rows.filter((r) => sel.isSelected(r.id));

  const canMerge = selectedRows.length >= 1;
  const cta =
    selectedRows.length === 0
      ? "Merge"
      : selectedRows.length === 1
        ? "Promote to composite →"
        : `Merge ${selectedRows.length} → composite →`;

  function toMember(r: EventRow): MergeMember {
    return {
      id: r.id,
      source: r.source,
      activityId: r.activityId,
      activityName: r.activityName,
      type: r.type,
      startedAt: r.startedAt,
      durationMinutes: r.durationMinutes,
    };
  }

  return (
    <>
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="px-3 py-2 w-8">
                <SelectAllCheckbox
                  allSelected={sel.allSelected}
                  someSelected={sel.someSelected}
                  onSelectAll={sel.selectAll}
                  onClear={sel.clearSelection}
                  disabled={selectableRows.length === 0}
                  selectAllLabel="Select all visible events on this page"
                  clearLabel="Clear selection of all visible events"
                />
              </th>
              <th className="text-left font-mono font-semibold px-3 py-2">Started at</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Activity</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Type</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-20">Dur.</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  No events match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((e) => {
                const isSelectable = e.status === "visible";
                const isChecked = sel.isSelected(e.id);
                return (
                  <tr
                    key={e.id}
                    className="relative border-t border-border hover:bg-surface/40"
                  >
                    <td className="px-3 py-2 w-8 relative z-10">
                      <RowSelectCheckbox
                        checked={isChecked}
                        onToggle={(shiftKey) => sel.toggleRange(e.id, shiftKey)}
                        disabled={!isSelectable}
                        ariaLabel={
                          isSelectable
                            ? `Select event ${e.id}`
                            : `Event ${e.id} cannot be selected (status: ${e.status})`
                        }
                        title={
                          isSelectable
                            ? undefined
                            : e.status === "composite"
                              ? "Already a composite. Open and Unmerge to combine differently."
                              : "Hidden by a composite. Open the parent to edit."
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      <Link
                        href={`/data/events/${e.id}`}
                        className="absolute inset-0"
                        aria-label={`Open event ${e.id}`}
                      />
                      {formatShort(e.startedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono">{e.activityName}</td>
                    <td className="px-3 py-2 font-mono text-muted">{e.type}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {e.durationMinutes ?? "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[0.75rem] text-muted">
                      {e.source}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Floating action bar — pinned to the bottom of the viewport when
          anything is selected. Stays out of the way otherwise. */}
      {selectedRows.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-background border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-4">
          <span className="text-[0.8125rem] font-mono">
            {selectedRows.length} selected
          </span>
          <button
            type="button"
            onClick={sel.clearSelection}
            className="text-[0.8125rem] text-muted hover:text-foreground"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!canMerge}
            className="px-3 py-1.5 text-[0.8125rem] bg-foreground text-background rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cta}
          </button>
        </div>
      )}

      {modalOpen && canMerge && (
        <CompositeMergeModal
          members={selectedRows.map(toMember)}
          activityOptions={activityOptions}
          typeSuggestionsByActivityId={typeSuggestionsByActivityId}
          onClose={() => setModalOpen(false)}
          onSuccess={(compositeId) => {
            sel.clearSelection();
            router.push(`/data/events/${compositeId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
