"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteGoalButton({ goalId }: { goalId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function del() {
    setSubmitting(true);
    await fetch(`/api/goals/${goalId}`, { method: "DELETE" });
    router.push("/goals");
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-4 py-2 border border-border rounded text-[0.8125rem] text-muted hover:text-accent-red hover:border-accent-red"
      >
        Delete Goal
      </button>
    );
  }

  return (
    <div className="flex gap-3">
      <button
        onClick={del}
        disabled={submitting}
        className="px-4 py-2 bg-accent-red text-white text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Deleting..." : "Confirm delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
