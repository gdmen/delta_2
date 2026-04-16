"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CloseFocusButton({ focusId }: { focusId: number }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function close(status: "completed" | "abandoned") {
    if (status === "completed" && !verdict.trim()) {
      setShowForm(true);
      return;
    }
    setSubmitting(true);
    await fetch(`/api/focuses/${focusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, verdict: verdict || undefined }),
    });
    router.refresh();
    setSubmitting(false);
  }

  if (!showForm) {
    return (
      <div className="flex gap-3">
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface"
        >
          Close with verdict
        </button>
        <button
          onClick={() => close("abandoned")}
          disabled={submitting}
          className="px-4 py-2 border border-border rounded text-[0.8125rem] text-muted hover:text-foreground hover:bg-surface disabled:opacity-50"
        >
          Abandon
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
        Verdict
      </div>
      <textarea
        value={verdict}
        onChange={(e) => setVerdict(e.target.value)}
        placeholder="What worked? What didn't? What will you carry forward to the next focus?"
        className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground min-h-[120px] resize-y"
      />
      <div className="flex gap-3">
        <button
          onClick={() => close("completed")}
          disabled={submitting || !verdict.trim()}
          className="px-5 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Closing..." : "Close Focus"}
        </button>
        <button
          onClick={() => { setShowForm(false); setVerdict(""); }}
          className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
