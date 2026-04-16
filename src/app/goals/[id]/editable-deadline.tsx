"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EditableGoalDeadline({
  goalId,
  initialDeadline,
}: {
  goalId: number;
  initialDeadline: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialDeadline);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value || value === initialDeadline) {
      setValue(initialDeadline);
      setEditing(false);
      return;
    }
    setSaving(true);
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deadline: value }),
    });
    setEditing(false);
    setSaving(false);
    router.refresh();
  }

  if (editing) {
    return (
      <input
        type="date"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setValue(initialDeadline); setEditing(false); }
        }}
        onBlur={save}
        disabled={saving}
        className="font-mono text-[0.9375rem] border border-border rounded px-2 py-1 outline-none focus:border-foreground disabled:opacity-60"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="font-mono text-[0.9375rem] hover:text-accent-orange transition-colors"
      title="Click to edit"
    >
      {initialDeadline}
    </button>
  );
}
