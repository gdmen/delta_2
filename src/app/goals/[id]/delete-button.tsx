"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Abandon a goal (soft-delete). Mirrors focuses' abandoned status so
 * goals are never hard-deleted from the UI - keeps history intact and
 * lets future-you see what didn't work out.
 *
 * When active focuses are linked to this goal, the confirm step offers
 * a checkbox to abandon them in the same request.
 */
export function AbandonGoalButton({
  goalId,
  currentStatus,
  activeLinkedFocusCount,
}: {
  goalId: number;
  currentStatus: "active" | "completed" | "abandoned";
  activeLinkedFocusCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cascadeFocuses, setCascadeFocuses] = useState(false);

  if (currentStatus === "abandoned") {
    return (
      <button
        onClick={async () => {
          setSubmitting(true);
          await fetch(`/api/goals/${goalId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          });
          router.refresh();
        }}
        disabled={submitting}
        className="px-4 py-2 border border-border rounded text-[0.8125rem] text-muted hover:text-foreground hover:border-foreground disabled:opacity-50"
      >
        {submitting ? "Reactivating..." : "Reactivate Goal"}
      </button>
    );
  }

  async function abandon() {
    setSubmitting(true);
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "abandoned",
        abandonLinkedFocuses: cascadeFocuses,
      }),
    });
    router.push("/goals");
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-4 py-2 border border-border rounded text-[0.8125rem] text-muted hover:text-accent-red hover:border-accent-red"
      >
        Abandon Goal
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {activeLinkedFocusCount > 0 && (
        <label className="flex items-center gap-2 text-[0.8125rem] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={cascadeFocuses}
            onChange={(e) => setCascadeFocuses(e.target.checked)}
            className="w-4 h-4"
          />
          Also abandon {activeLinkedFocusCount} linked active{" "}
          {activeLinkedFocusCount === 1 ? "focus" : "focuses"}
        </label>
      )}
      <div className="flex gap-3">
        <button
          onClick={abandon}
          disabled={submitting}
          className="px-4 py-2 bg-accent-red text-white text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Abandoning..." : "Confirm abandon"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setCascadeFocuses(false);
          }}
          className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
