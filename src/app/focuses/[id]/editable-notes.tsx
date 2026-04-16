"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export function EditableFocusNotes({
  focusId,
  initialNotes,
}: {
  focusId: number;
  initialNotes: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    setValue(initialNotes);
  }, [initialNotes]);

  async function save() {
    if (value === initialNotes) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/focuses/${focusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technicalNotes: value }),
    });
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
    setSaving(false);
  }

  function cancel() {
    setValue(initialNotes);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <textarea
          ref={textareaRef}
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          placeholder="What are you working on technically? Programming details, techniques, protocols..."
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] leading-[1.7] focus:outline-none focus:border-foreground min-h-[160px] resize-y disabled:opacity-60"
        />
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="px-4 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!initialNotes) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[0.875rem] text-muted italic hover:text-foreground text-left"
      >
        No technical plan yet. Click to add one.
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-[0.875rem] leading-[1.7] text-text-secondary whitespace-pre-wrap text-left hover:bg-surface/40 -mx-2 px-2 py-1 rounded block w-full"
      title="Click to edit"
    >
      {initialNotes}
    </button>
  );
}
