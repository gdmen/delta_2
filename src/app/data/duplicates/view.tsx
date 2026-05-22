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
            <button
              type="button"
              onClick={dismissSelected}
              disabled={bulkRunning}
              className="px-3 py-1 text-[0.75rem] font-medium border border-accent-red/40 text-accent-red rounded hover:bg-accent-red/10 disabled:opacity-50 whitespace-nowrap"
            >
              {bulkRunning
                ? "Dismissing…"
                : `Dismiss ${selectedGroups.length} selected`}
            </button>
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
          {pairs.map((p) => {
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
