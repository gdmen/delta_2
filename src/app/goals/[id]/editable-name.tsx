"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The goal's user-facing title. When `initialName` is null the field
 * renders the derived `<metric> <target><unit>` as a muted placeholder
 * so the page never shows an empty title row. Submitting an empty
 * string clears the name back to null (server normalizes).
 */
export function EditableGoalName({
  goalId,
  initialName,
  placeholder,
}: {
  goalId: number;
  initialName: string | null;
  placeholder: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialName ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = value.trim();
    const current = initialName ?? "";
    if (trimmed === current) {
      setValue(current);
      setEditing(false);
      return;
    }
    setSaving(true);
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed.length > 0 ? trimmed : null }),
    });
    setEditing(false);
    setSaving(false);
    router.refresh();
  }

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        autoFocus
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(initialName ?? "");
            setEditing(false);
          }
        }}
        onBlur={save}
        disabled={saving}
        placeholder={placeholder}
        className="w-full text-2xl font-semibold bg-transparent border-b border-foreground outline-none disabled:opacity-60"
      />
    );
  }

  const display = initialName?.trim() || placeholder;
  const isPlaceholder = !initialName?.trim();

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`text-left text-2xl font-semibold hover:text-accent-orange transition-colors ${isPlaceholder ? "text-muted italic" : ""}`}
      title="Click to edit name"
    >
      {display}
    </button>
  );
}
