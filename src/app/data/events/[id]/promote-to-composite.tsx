"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CompositeMergeModal,
  type MergeMember,
  type ActivityOption,
} from "@/components/composite-merge-modal";

/**
 * Single-event action: wrap this event in a composite that has a
 * corrected canonical activity. Useful when a source emits a generic
 * activity type (Strava `Workout`, Apple Health `Other`, WHOOP
 * `Activity`) but the user knows what it actually was.
 *
 * Shown on regular event detail pages; hidden on composite and
 * hidden_by_composite rows (those flow through unmerge instead).
 */
export function PromoteToCompositeButton({
  member,
  activityOptions,
  typeSuggestionsByActivityId,
}: {
  member: MergeMember;
  activityOptions: ActivityOption[];
  typeSuggestionsByActivityId?: Record<number, string[]>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground border border-border rounded"
        title="Wrap this event in a composite that has a corrected canonical activity"
      >
        Make composite (override activity) →
      </button>
      {open && (
        <CompositeMergeModal
          members={[member]}
          activityOptions={activityOptions}
          typeSuggestionsByActivityId={typeSuggestionsByActivityId}
          onClose={() => setOpen(false)}
          onSuccess={(compositeId) => {
            router.push(`/data/events/${compositeId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
