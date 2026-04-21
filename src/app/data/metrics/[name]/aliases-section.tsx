"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  metricTypeId: number;
  initialAliases: string[];
}

/**
 * "Aliases" section on the metric detail page. Lists every alias that routes
 * incoming ingest to this metric_type, with a per-alias remove button.
 */
export function AliasesSection({ metricTypeId, initialAliases }: Props) {
  const router = useRouter();
  const [aliases, setAliases] = useState(initialAliases);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (aliases.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-2">
          Aliases
        </h2>
        <p className="text-[0.8125rem] text-muted">
          No aliases route here. Merge this metric with another from{" "}
          <code className="font-mono">/data</code> to create one.
        </p>
      </section>
    );
  }

  async function remove(alias: string) {
    setRemoving(alias);
    setError(null);
    try {
      const res = await fetch(
        `/api/metric-types/${metricTypeId}/aliases/${encodeURIComponent(alias)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setAliases((a) => a.filter((x) => x !== alias));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-2">
        Aliases
      </h2>
      <p className="text-[0.8125rem] text-text-secondary mb-3">
        Raw import names that route incoming data here. Remove to stop routing —
        future imports under the removed name will auto-create a new metric type.
      </p>
      <ul className="border border-border rounded divide-y divide-border">
        {aliases.map((alias) => (
          <li
            key={alias}
            className="flex items-center justify-between px-3 py-2 gap-3"
          >
            <code className="font-mono text-[0.8125rem] truncate">{alias}</code>
            <button
              type="button"
              onClick={() => remove(alias)}
              disabled={removing === alias}
              className="text-[0.75rem] text-muted hover:text-red-400 disabled:opacity-50"
            >
              {removing === alias ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div className="mt-2 text-[0.75rem] text-red-400">{error}</div>
      )}
    </section>
  );
}
