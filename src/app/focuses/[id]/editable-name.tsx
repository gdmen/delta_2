"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export function EditableFocusName({ focusId, initialName }: { focusId: number; initialName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setValue(initialName);
  }, [initialName]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialName) {
      setValue(initialName);
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/focuses/${focusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
    setSaving(false);
  }

  function cancel() {
    setValue(initialName);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        onBlur={save}
        className="text-2xl font-semibold bg-transparent border-b border-foreground outline-none w-full disabled:opacity-60"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-2xl font-semibold text-left hover:text-accent-orange transition-colors"
      title="Click to edit"
    >
      {initialName}
    </button>
  );
}
