"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FocusEntryForm({ focusId }: { focusId: number }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);

    const res = await fetch(`/api/focuses/${focusId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (res.ok) {
      setContent("");
      router.refresh();
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What happened today? Techniques drilled, how it felt, what you noticed..."
        className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground min-h-[100px] resize-y"
      />
      <button
        type="submit"
        disabled={submitting || !content.trim()}
        className="px-5 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Adding..." : "Add Entry"}
      </button>
    </form>
  );
}
