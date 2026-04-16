"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EditableGoalTarget({
  goalId,
  initialValue,
  unit,
}: {
  goalId: number;
  initialValue: number;
  unit: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialValue));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed === initialValue) {
      setValue(String(initialValue));
      setEditing(false);
      return;
    }
    setSaving(true);
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetValue: parsed }),
    });
    setEditing(false);
    setSaving(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="any"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { setValue(String(initialValue)); setEditing(false); }
          }}
          onBlur={save}
          disabled={saving}
          className="font-mono text-2xl font-semibold bg-transparent border-b border-foreground outline-none w-40 disabled:opacity-60"
        />
        <span className="font-mono text-[1rem] text-muted">{unit}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-baseline gap-2 hover:text-accent-orange transition-colors"
      title="Click to edit"
    >
      <span className="font-mono text-2xl font-semibold">{initialValue}</span>
      <span className="font-mono text-[1rem] text-muted">{unit}</span>
    </button>
  );
}
