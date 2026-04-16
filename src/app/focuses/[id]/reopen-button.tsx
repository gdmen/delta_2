"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReopenFocusButton({ focusId, currentStatus }: { focusId: number; currentStatus: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function reopen() {
    setSubmitting(true);
    const res = await fetch(`/api/focuses/${focusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    if (res.ok) router.refresh();
    setSubmitting(false);
  }

  const wasAccidentally = currentStatus === "completed" ? "closed" : "abandoned";

  return (
    <div>
      <p className="text-[0.8125rem] text-muted mb-3">
        This focus was {wasAccidentally}. Reopening will mark it active again and clear the end date.
      </p>
      <button
        onClick={reopen}
        disabled={submitting}
        className="px-4 py-2 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface disabled:opacity-50"
      >
        {submitting ? "Reopening..." : "↻ Reopen Focus"}
      </button>
    </div>
  );
}
