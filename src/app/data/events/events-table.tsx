"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatShort } from "@/lib/format";
import {
  CompositeMergeModal,
  type MergeMember,
  type SportOption,
} from "@/components/composite-merge-modal";

export interface EventRow {
  id: number;
  startedAt: string;
  sportId: number;
  sportName: string;
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
 *   - 1 selected → "Promote to composite" (sport retag).
 *   - 2+ selected → "Merge N → composite". The API rejects any two
 *     members sharing a source, so the modal surfaces the error
 *     in-line if the user picks colliding rows.
 */
export function EventsTable({
  rows,
  sportOptions,
  typeSuggestionsBySportId,
}: {
  rows: EventRow[];
  sportOptions: SportOption[];
  typeSuggestionsBySportId?: Record<number, string[]>;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const selectableRows = rows.filter((r) => r.status === "visible");
  const selectableIds = new Set(selectableRows.map((r) => r.id));
  // Drop stale ids when filters/pagination change the row set out from
  // under us, otherwise the action-bar count diverges from the visible
  // checkmarks.
  const cleanSelected = new Set(
    [...selectedIds].filter((id) => selectableIds.has(id)),
  );

  const allSelectableChecked =
    selectableRows.length > 0 && cleanSelected.size === selectableRows.length;
  const someSelectableChecked = cleanSelected.size > 0 && !allSelectableChecked;

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelectableChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }

  const selectedList = rows.filter((r) => cleanSelected.has(r.id));
  const canMerge = selectedList.length >= 1;
  const cta =
    selectedList.length === 0
      ? "Merge"
      : selectedList.length === 1
        ? "Promote to composite →"
        : `Merge ${selectedList.length} → composite →`;

  function toMember(r: EventRow): MergeMember {
    return {
      id: r.id,
      source: r.source,
      sportId: r.sportId,
      sportName: r.sportName,
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
                <input
                  type="checkbox"
                  checked={allSelectableChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelectableChecked;
                  }}
                  onChange={toggleAll}
                  disabled={selectableRows.length === 0}
                  aria-label="Select all visible events on this page"
                />
              </th>
              <th className="text-left font-mono font-semibold px-3 py-2">Started at</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Sport</th>
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
                const isChecked = cleanSelected.has(e.id);
                return (
                  <tr
                    key={e.id}
                    className="relative border-t border-border hover:bg-surface/40"
                  >
                    <td className="px-3 py-2 w-8 relative z-10">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(e.id)}
                        disabled={!isSelectable}
                        aria-label={
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
                    <td className="px-3 py-2 font-mono">{e.sportName}</td>
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
      {cleanSelected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-background border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-4">
          <span className="text-[0.8125rem] font-mono">
            {cleanSelected.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
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
          members={selectedList.map(toMember)}
          sportOptions={sportOptions}
          typeSuggestionsBySportId={typeSuggestionsBySportId}
          onClose={() => setModalOpen(false)}
          onSuccess={(compositeId) => {
            setSelectedIds(new Set());
            router.push(`/data/events/${compositeId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
