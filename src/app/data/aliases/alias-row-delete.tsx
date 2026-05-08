"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline delete affordance for a row in the Aliases tab. Click → optimistic
 * spinner; on success the page is refreshed (server component re-queries
 * the alias list and the row drops out). Errors surface inline and leave
 * the row in place.
 */
export function AliasRowDelete({
  alias,
  canonicalId,
  canonicalName,
}: {
  alias: string;
  canonicalId: number;
  canonicalName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    if (
      !confirm(
        `Delete the alias "${alias}" → ${canonicalName}?\n\nFuture ingests of "${alias}" will fall back to auto-creating an orphan instead of routing here.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/metric-types/${canonicalId}/aliases/${encodeURIComponent(alias)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErr(json.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (err) {
    return (
      <span className="text-[0.75rem] text-accent-red font-mono">
        Failed: {err}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-[0.75rem] text-accent-red hover:underline disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
