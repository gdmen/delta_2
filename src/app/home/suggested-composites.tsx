"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CandidatePair } from "@/lib/duplicates/detector";
import {
  CompositeMergeModal,
  type SportOption,
} from "@/components/composite-merge-modal";

/**
 * Home-page card showing recent duplicate-event candidates. Each pair
 * gets a Merge… or Not a duplicate button. Dismissals POST to the
 * single-dismiss endpoint; merges open the composite-merge modal.
 *
 * Server fetched `pairs` (last 14d) and `sportOptions` (the user's
 * sports list) — this client component just handles the per-pair
 * interactions and re-renders via router.refresh() on success.
 */
export function SuggestedComposites({
  pairs,
  sportOptions,
}: {
  pairs: CandidatePair[];
  sportOptions: SportOption[];
}) {
  const router = useRouter();
  const [mergeTarget, setMergeTarget] = useState<CandidatePair | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  async function dismiss(p: CandidatePair) {
    const key = `${p.aId}-${p.bId}`;
    setDismissing(key);
    await fetch("/api/events/duplicates/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aId: p.aId, bId: p.bId }),
    });
    setDismissing(null);
    router.refresh();
  }

  return (
    <section>
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Suggested composites
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {pairs.length} from last 14 days
        </span>
      </div>

      {pairs.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">
          No duplicate-event candidates in the last 14 days.{" "}
          <Link
            href="/data/duplicates"
            className="underline hover:text-foreground"
          >
            Browse older candidates →
          </Link>
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {pairs.map((p) => (
              <PairCard
                key={`${p.aId}-${p.bId}`}
                p={p}
                onMerge={() => setMergeTarget(p)}
                onDismiss={() => dismiss(p)}
                dismissing={dismissing === `${p.aId}-${p.bId}`}
              />
            ))}
          </div>
          <div className="mt-4 text-[0.8125rem]">
            <Link
              href="/data/duplicates"
              className="text-muted underline hover:text-foreground"
            >
              Show older candidates →
            </Link>
          </div>
        </>
      )}

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
    </section>
  );
}

function PairCard({
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
  const bTime = p.bStartedAt.slice(0, 16).replace("T", " ");
  return (
    <div className="border border-border rounded p-3 space-y-2">
      <div className="text-[0.6875rem] font-mono text-muted">
        {p.minutesApart.toFixed(0)} min apart
      </div>
      <MemberLine
        id={p.aId}
        source={p.aSource}
        sportName={p.aSportName}
        type={p.aType}
        time={aTime}
        durationMinutes={p.aDurationMinutes}
      />
      <MemberLine
        id={p.bId}
        source={p.bSource}
        sportName={p.bSportName}
        type={p.bType}
        time={bTime}
        durationMinutes={p.bDurationMinutes}
      />
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="px-2 py-1 text-[0.75rem] text-muted hover:text-foreground disabled:opacity-50"
        >
          {dismissing ? "Dismissing…" : "Not a duplicate"}
        </button>
        <button
          type="button"
          onClick={onMerge}
          className="px-3 py-1 text-[0.75rem] bg-foreground text-background rounded hover:opacity-90"
        >
          Merge…
        </button>
      </div>
    </div>
  );
}

function MemberLine({
  id,
  source,
  sportName,
  type,
  time,
  durationMinutes,
}: {
  id: number;
  source: string;
  sportName: string;
  type: string;
  time: string;
  durationMinutes: number | null;
}) {
  return (
    <div className="font-mono text-[0.75rem] flex gap-3 items-baseline">
      <Link
        href={`/data/events/${id}`}
        className="text-muted uppercase tracking-wider hover:text-foreground whitespace-nowrap"
        title={`Open event #${id}`}
      >
        {source}
      </Link>
      <span className="flex-1 truncate">
        {sportName} · {type}
      </span>
      <span className="text-muted whitespace-nowrap">
        {time}
        {durationMinutes ? ` · ${durationMinutes}m` : ""}
      </span>
    </div>
  );
}
