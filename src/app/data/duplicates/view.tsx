"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CandidateGroup,
  CandidatePair,
} from "@/lib/duplicates/detector";
import {
  CompositeMergeModal,
  type SportOption,
} from "@/components/composite-merge-modal";

/**
 * Two-tier view:
 *   - Top: source/sport-pair groups with bulk-dismiss-all button.
 *   - Bottom: flat list of individual pairs for per-pair merge.
 */
export function DuplicatesView({
  pairs,
  groups,
  sportOptions,
}: {
  pairs: CandidatePair[];
  groups: CandidateGroup[];
  sportOptions: SportOption[];
}) {
  const router = useRouter();
  const [mergeTarget, setMergeTarget] = useState<CandidatePair | null>(null);
  const [bulkRunning, setBulkRunning] = useState<string | null>(null);
  const [individualRunning, setIndividualRunning] = useState<string | null>(null);

  async function bulkDismiss(g: CandidateGroup) {
    const key = `${g.sportIdA}-${g.sportIdB}-${g.sourceA}-${g.sourceB}`;
    if (
      !confirm(
        `Dismiss all ${g.count} pairs of ${g.sourceA}/${g.sportNameA} + ${g.sourceB}/${g.sportNameB}?`,
      )
    ) {
      return;
    }
    setBulkRunning(key);
    await fetch("/api/events/duplicates/bulk-dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceA: g.sourceA,
        sportIdA: g.sportIdA,
        sourceB: g.sourceB,
        sportIdB: g.sportIdB,
      }),
    });
    setBulkRunning(null);
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
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3 border-b border-border pb-2">
          Bulk dismiss by source/sport pair
        </h2>
        <div className="space-y-2">
          {groups.map((g) => {
            const key = `${g.sportIdA}-${g.sportIdB}-${g.sourceA}-${g.sourceB}`;
            return (
              <div
                key={key}
                className="flex justify-between items-center border border-border rounded px-3 py-2 font-mono text-[0.8125rem]"
              >
                <div className="flex gap-3 items-baseline truncate">
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
                <div className="flex gap-3 items-baseline whitespace-nowrap">
                  <span className="text-muted text-[0.6875rem]">
                    {g.count} pair{g.count === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    onClick={() => bulkDismiss(g)}
                    disabled={bulkRunning === key}
                    className="px-2 py-1 text-[0.75rem] text-muted hover:text-accent-red disabled:opacity-50"
                  >
                    {bulkRunning === key ? "Dismissing…" : "Dismiss all"}
                  </button>
                </div>
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
          a={{
            id: mergeTarget.aId,
            source: mergeTarget.aSource,
            sportId: mergeTarget.aSportId,
            sportName: mergeTarget.aSportName,
            type: mergeTarget.aType,
            startedAt: mergeTarget.aStartedAt,
            durationMinutes: mergeTarget.aDurationMinutes,
          }}
          b={{
            id: mergeTarget.bId,
            source: mergeTarget.bSource,
            sportId: mergeTarget.bSportId,
            sportName: mergeTarget.bSportName,
            type: mergeTarget.bType,
            startedAt: mergeTarget.bStartedAt,
            durationMinutes: mergeTarget.bDurationMinutes,
          }}
          sportOptions={sportOptions}
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
  const aTime = p.aStartedAt.slice(0, 16).replace("T", " ");
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
