"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CandidatePair } from "@/lib/duplicates/detector";
import { formatShort } from "@/lib/format";
import {
  CompositeMergeModal,
  type ActivityOption,
} from "@/components/composite-merge-modal";

/**
 * Home-page card showing recent duplicate-event candidates. Each pair
 * gets a Merge… or Not a duplicate button. Dismissals POST to the
 * single-dismiss endpoint; merges open the composite-merge modal.
 *
 * Server fetched `pairs` (last 14d) and `activityOptions` (the user's
 * activities list) — this client component just handles the per-pair
 * interactions and re-renders via router.refresh() on success.
 */
export function SuggestedComposites({
  pairs,
  activityOptions,
  typeSuggestionsByActivityId,
}: {
  pairs: CandidatePair[];
  activityOptions: ActivityOption[];
  typeSuggestionsByActivityId?: Record<number, string[]>;
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
          members={[
            {
              id: mergeTarget.aId,
              source: mergeTarget.aSource,
              activityId: mergeTarget.aActivityId,
              activityName: mergeTarget.aActivityName,
              type: mergeTarget.aType,
              startedAt: mergeTarget.aStartedAt,
              durationMinutes: mergeTarget.aDurationMinutes,
            },
            {
              id: mergeTarget.bId,
              source: mergeTarget.bSource,
              activityId: mergeTarget.bActivityId,
              activityName: mergeTarget.bActivityName,
              type: mergeTarget.bType,
              startedAt: mergeTarget.bStartedAt,
              durationMinutes: mergeTarget.bDurationMinutes,
            },
          ]}
          activityOptions={activityOptions}
          typeSuggestionsByActivityId={typeSuggestionsByActivityId}
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
  const aTime = formatShort(p.aStartedAt);
  const bTime = formatShort(p.bStartedAt);
  return (
    <div className="border border-border rounded p-3 space-y-2">
      <div className="text-[0.6875rem] font-mono text-muted">
        {p.minutesApart.toFixed(0)} min apart
      </div>
      <MemberLine
        id={p.aId}
        source={p.aSource}
        activityName={p.aActivityName}
        type={p.aType}
        time={aTime}
        durationMinutes={p.aDurationMinutes}
      />
      <MemberLine
        id={p.bId}
        source={p.bSource}
        activityName={p.bActivityName}
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
  activityName,
  type,
  time,
  durationMinutes,
}: {
  id: number;
  source: string;
  activityName: string;
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
        {activityName} · {type}
      </span>
      <span className="text-muted whitespace-nowrap">
        {time}
        {durationMinutes ? ` · ${durationMinutes}m` : ""}
      </span>
    </div>
  );
}
