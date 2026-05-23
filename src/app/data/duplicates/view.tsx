"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CandidateGroup,
  CandidatePair,
} from "@/lib/duplicates/detector";
import { formatShort } from "@/lib/format";
import {
  CompositeMergeModal,
  type SportOption,
} from "@/components/composite-merge-modal";
import { useRowSelection } from "@/components/use-row-selection";
import { SelectAllCheckbox } from "@/components/select-all-checkbox";
import { RowSelectCheckbox } from "@/components/row-select-checkbox";

/**
 * Two-tier view:
 *   - Top: source/sport-pair groups with bulk-dismiss-all button.
 *   - Bottom: flat list of individual pairs for per-pair merge.
 */
export function DuplicatesView({
  pairs,
  groups,
  sportOptions,
  typeSuggestionsBySportId,
}: {
  pairs: CandidatePair[];
  groups: CandidateGroup[];
  sportOptions: SportOption[];
  typeSuggestionsBySportId?: Record<number, string[]>;
}) {
  const router = useRouter();
  const [mergeTarget, setMergeTarget] = useState<CandidatePair | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [individualRunning, setIndividualRunning] = useState<string | null>(null);
  // Bulk merge is single-group only (multiple selected groups would each
  // need their own composite sport, so they stay dismiss-only). When one
  // group is selected, this dialog picks the composite sport once.
  // The group is snapshotted when the dialog opens (not read live) so
  // changing the selection while it's open can't merge a different group
  // than the one shown.
  const [mergeGroup, setMergeGroup] = useState<CandidateGroup | null>(null);
  const [mergeSportId, setMergeSportId] = useState<number | null>(null);
  const [bulkMergeRunning, setBulkMergeRunning] = useState(false);
  // The "All pairs" list is unbounded now (no detector LIMIT), so paginate
  // it client-side rather than rendering thousands of rows.
  const [pairPage, setPairPage] = useState(0);

  // Multi-select state for the top section, keyed by the stable group key
  // (all fields come off the canonicalized group object). The selection
  // machine is shared with the catalogs and the events list.
  const groupKey = (g: CandidateGroup) =>
    `${g.sportIdA}-${g.sportIdB}-${g.sourceA}-${g.sourceB}`;
  const sel = useRowSelection(groups.map(groupKey));
  const selectedGroups = groups.filter((g) => sel.isSelected(groupKey(g)));
  const selectedPairCount = selectedGroups.reduce((n, g) => n + g.count, 0);

  async function dismissSelected() {
    if (selectedGroups.length === 0 || bulkRunning) return;
    const nPairs = selectedPairCount;
    const nGroups = selectedGroups.length;
    if (
      !confirm(
        `Dismiss ${nPairs} pair${nPairs === 1 ? "" : "s"} across ${nGroups} source/sport group${nGroups === 1 ? "" : "s"}?`,
      )
    ) {
      return;
    }
    setBulkRunning(true);
    await fetch("/api/events/duplicates/bulk-dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups: selectedGroups.map((g) => ({
          sourceA: g.sourceA,
          sportIdA: g.sportIdA,
          sourceB: g.sourceB,
          sportIdB: g.sportIdB,
        })),
      }),
    });
    setBulkRunning(false);
    sel.clearSelection();
    router.refresh();
  }

  function openMergeDialog() {
    const g = selectedGroups[0];
    if (!g) return;
    // Default to the clean, non-source-prefixed sport name if either side
    // has one (mirrors the per-pair modal's pickDefaultSport).
    const defaultSport = !g.sportNameA.includes(":")
      ? g.sportIdA
      : !g.sportNameB.includes(":")
        ? g.sportIdB
        : g.sportIdA;
    setMergeSportId(defaultSport);
    setMergeGroup(g);
  }

  async function runBulkMerge() {
    const g = mergeGroup;
    if (!g || mergeSportId === null || bulkMergeRunning) return;
    setBulkMergeRunning(true);
    await fetch("/api/events/duplicates/bulk-merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        group: {
          sourceA: g.sourceA,
          sportIdA: g.sportIdA,
          sourceB: g.sourceB,
          sportIdB: g.sportIdB,
        },
        sportId: mergeSportId,
      }),
    });
    setBulkMergeRunning(false);
    setMergeGroup(null);
    sel.clearSelection();
    router.refresh();
  }

  async function dismissOne(p: CandidatePair) {
    const key = `${p.aId}-${p.bId}`;
    setIndividualRunning(key);
    await fetch("/api/events/duplicates/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aId: p.aId, bId: p.bId }),
    });
    setIndividualRunning(null);
    router.refresh();
  }

  if (pairs.length === 0) {
    return (
      <p className="text-[0.875rem] text-muted py-8 text-center">
        No candidate pairs. New cross-source events will surface here as
        they ingest.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3 border-b border-border pb-2 gap-3">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Bulk dismiss by source/sport pair
          </h2>
          {selectedGroups.length > 0 && (
            <div className="flex items-center gap-2">
              {/* Bulk merge is single-group only; with 2+ groups selected
                  the only action is dismiss. */}
              {selectedGroups.length === 1 && (
                <button
                  type="button"
                  onClick={openMergeDialog}
                  disabled={bulkRunning || bulkMergeRunning}
                  className="px-3 py-1 text-[0.75rem] font-medium bg-foreground text-background rounded hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  Merge {selectedPairCount} pair{selectedPairCount === 1 ? "" : "s"}…
                </button>
              )}
              <button
                type="button"
                onClick={dismissSelected}
                disabled={bulkRunning || bulkMergeRunning}
                className="px-3 py-1 text-[0.75rem] font-medium border border-accent-red/40 text-accent-red rounded hover:bg-accent-red/10 disabled:opacity-50 whitespace-nowrap"
              >
                {bulkRunning
                  ? "Dismissing…"
                  : `Dismiss ${selectedGroups.length} selected`}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {/* Select-all header */}
          <label className="flex items-center gap-3 px-3 py-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-muted cursor-pointer select-none">
            <SelectAllCheckbox
              allSelected={sel.allSelected}
              someSelected={sel.someSelected}
              onSelectAll={sel.selectAll}
              onClear={sel.clearSelection}
              disabled={bulkRunning || groups.length === 0}
              selectAllLabel="Select all source/sport groups"
              clearLabel="Clear selection of all source/sport groups"
            />
            Select all ({groups.length})
          </label>
          {groups.map((g) => {
            const key = groupKey(g);
            const isChecked = sel.isSelected(key);
            return (
              <div
                key={key}
                className={`flex justify-between items-center border border-border rounded px-3 py-2 font-mono text-[0.8125rem] ${
                  isChecked ? "bg-surface/60" : ""
                }`}
              >
                <div className="flex gap-3 items-center truncate min-w-0">
                  <RowSelectCheckbox
                    checked={isChecked}
                    onToggle={(shiftKey) => sel.toggleRange(key, shiftKey)}
                    disabled={bulkRunning}
                    ariaLabel={`Select ${g.sourceA} ${g.sportNameA} plus ${g.sourceB} ${g.sportNameB}`}
                    className="flex-shrink-0"
                  />
                  <div className="flex gap-3 items-baseline truncate min-w-0">
                    <span className="text-muted uppercase tracking-wider whitespace-nowrap">
                      {g.sourceA}
                    </span>
                    <span className="truncate">{g.sportNameA}</span>
                    <span className="text-muted">+</span>
                    <span className="text-muted uppercase tracking-wider whitespace-nowrap">
                      {g.sourceB}
                    </span>
                    <span className="truncate">{g.sportNameB}</span>
                  </div>
                </div>
                <span className="text-muted text-[0.6875rem] whitespace-nowrap">
                  {g.count} pair{g.count === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3 border-b border-border pb-2">
          All pairs ({pairs.length})
        </h2>
        <div className="space-y-2">
          {(() => {
            const PER_PAGE = 50;
            const pageCount = Math.max(1, Math.ceil(pairs.length / PER_PAGE));
            const page = Math.min(pairPage, pageCount - 1);
            const start = page * PER_PAGE;
            const visible = pairs.slice(start, start + PER_PAGE);
            return (
              <>
                {visible.map((p) => {
                  const key = `${p.aId}-${p.bId}`;
                  return (
                    <PairRow
                      key={key}
                      p={p}
                      onMerge={() => setMergeTarget(p)}
                      onDismiss={() => dismissOne(p)}
                      dismissing={individualRunning === key}
                    />
                  );
                })}
                {pageCount > 1 && (
                  <div className="flex items-center justify-between pt-2 text-[0.75rem] text-muted">
                    <span>
                      {start + 1}–{Math.min(start + PER_PAGE, pairs.length)} of{" "}
                      {pairs.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPairPage(Math.max(0, page - 1))}
                        disabled={page === 0}
                        className="px-2 py-1 border border-border rounded hover:bg-surface/40 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <span className="px-1 py-1 font-mono">
                        {page + 1}/{pageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPairPage(Math.min(pageCount - 1, page + 1))
                        }
                        disabled={page >= pageCount - 1}
                        className="px-2 py-1 border border-border rounded hover:bg-surface/40 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </section>

      {mergeTarget && (
        <CompositeMergeModal
          members={[
            {
              id: mergeTarget.aId,
              source: mergeTarget.aSource,
              sportId: mergeTarget.aSportId,
              sportName: mergeTarget.aSportName,
              type: mergeTarget.aType,
              startedAt: mergeTarget.aStartedAt,
              durationMinutes: mergeTarget.aDurationMinutes,
            },
            {
              id: mergeTarget.bId,
              source: mergeTarget.bSource,
              sportId: mergeTarget.bSportId,
              sportName: mergeTarget.bSportName,
              type: mergeTarget.bType,
              startedAt: mergeTarget.bStartedAt,
              durationMinutes: mergeTarget.bDurationMinutes,
            },
          ]}
          sportOptions={sportOptions}
          typeSuggestionsBySportId={typeSuggestionsBySportId}
          onClose={() => setMergeTarget(null)}
        />
      )}

      {mergeGroup && mergeSportId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !bulkMergeRunning && setMergeGroup(null)}
        >
          <div
            className="bg-background border border-border rounded-lg max-w-sm w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[1rem] font-semibold">
              Merge {mergeGroup.count} pair{mergeGroup.count === 1 ? "" : "s"}
            </h2>
            <p className="text-[0.8125rem] text-muted">
              {mergeGroup.sourceA} {mergeGroup.sportNameA} + {mergeGroup.sourceB}{" "}
              {mergeGroup.sportNameB}. Overlapping recordings of one session are
              combined into a single composite.
            </p>
            <div>
              <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
                Composite sport
              </label>
              <select
                value={mergeSportId}
                onChange={(e) => setMergeSportId(Number(e.target.value))}
                disabled={bulkMergeRunning}
                className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
              >
                {sportOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMergeGroup(null)}
                disabled={bulkMergeRunning}
                className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runBulkMerge}
                disabled={bulkMergeRunning}
                className="px-3 py-1.5 text-[0.8125rem] bg-foreground text-background rounded hover:opacity-90 disabled:opacity-50"
              >
                {bulkMergeRunning ? "Merging…" : "Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PairRow({
  p,
  onMerge,
  onDismiss,
  dismissing,
}: {
  p: CandidatePair;
  onMerge: () => void;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const aTime = formatShort(p.aStartedAt);
  return (
    <div className="border border-border rounded px-3 py-2 flex justify-between items-baseline gap-3 font-mono text-[0.75rem]">
      <div className="flex gap-2 items-baseline truncate min-w-0">
        <Link
          href={`/data/events/${p.aId}`}
          className="text-muted uppercase tracking-wider hover:text-foreground whitespace-nowrap"
        >
          {p.aSource}
        </Link>
        <span className="truncate">{p.aSportName}</span>
        <span className="text-muted">+</span>
        <Link
          href={`/data/events/${p.bId}`}
          className="text-muted uppercase tracking-wider hover:text-foreground whitespace-nowrap"
        >
          {p.bSource}
        </Link>
        <span className="truncate">{p.bSportName}</span>
        <span className="text-muted whitespace-nowrap">· {aTime}</span>
      </div>
      <div className="flex gap-2 whitespace-nowrap">
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="px-2 py-1 text-muted hover:text-foreground disabled:opacity-50"
        >
          {dismissing ? "…" : "Dismiss"}
        </button>
        <button
          type="button"
          onClick={onMerge}
          className="px-2 py-1 bg-foreground text-background rounded hover:opacity-90"
        >
          Merge…
        </button>
      </div>
    </div>
  );
}
