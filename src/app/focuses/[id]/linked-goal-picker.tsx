"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface GoalOption {
  id: number;
  targetValue: number;
  deadline: string;
  metricName: string;
  metricUnit: string;
}

export function LinkedGoalPicker({
  focusId,
  editable,
  currentGoalId,
  availableGoals,
}: {
  focusId: number;
  editable: boolean;
  currentGoalId: number | null;
  availableGoals: GoalOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<number | null>(currentGoalId);

  const currentGoal = availableGoals.find((g) => g.id === currentGoalId) ?? null;

  async function save() {
    setSaving(true);
    await fetch(`/api/focuses/${focusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId: draft }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  // Read-only state.
  if (!editing) {
    if (currentGoal) {
      return (
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/goals/${currentGoal.id}`}
            className="text-[0.875rem] font-medium hover:text-accent-orange"
          >
            {currentGoal.metricName} {currentGoal.targetValue}{currentGoal.metricUnit}{" "}
            <span className="font-mono text-[0.75rem] text-muted">by {currentGoal.deadline}</span>
          </Link>
          {editable && (
            <button
              onClick={() => { setDraft(currentGoalId); setEditing(true); }}
              className="text-[0.75rem] text-muted hover:text-foreground"
            >
              Change
            </button>
          )}
        </div>
      );
    }

    // No linked goal.
    if (editable && availableGoals.length > 0) {
      return (
        <button
          onClick={() => { setDraft(null); setEditing(true); }}
          className="text-[0.875rem] text-muted italic hover:text-foreground text-left"
        >
          Not linked to a goal. Click to link one.
        </button>
      );
    }

    if (editable && availableGoals.length === 0) {
      return (
        <p className="text-[0.875rem] text-muted italic">
          Not linked to a goal. No active goals for this sport -{" "}
          <Link href="/input/goal" className="text-foreground underline">add one</Link>.
        </p>
      );
    }

    return <p className="text-[0.875rem] text-muted italic">Not linked to a goal.</p>;
  }

  // Edit state.
  return (
    <div className="space-y-3">
      <select
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value === "" ? null : parseInt(e.target.value, 10))}
        disabled={saving}
        className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground disabled:opacity-50"
      >
        <option value="">- None (standalone focus) -</option>
        {availableGoals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.metricName} {g.targetValue}{g.metricUnit} by {g.deadline}
          </option>
        ))}
      </select>
      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setDraft(currentGoalId); setEditing(false); }}
          disabled={saving}
          className="px-4 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
