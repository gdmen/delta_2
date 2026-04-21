"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

interface MetricTypeRow {
  id: number;
  name: string;
  unit: string;
  count: number;
  lastAt: string | null;
}

export function MetricsTable({ rows }: { rows: MetricTypeRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div>
      <div className="mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter metrics..."
          className="w-full max-w-xs px-3 py-1.5 border border-border rounded text-[0.875rem]"
        />
      </div>
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-24">Rows</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-40">Last</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted text-[0.8125rem]">
                  No metrics match &quot;{q}&quot;.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="relative border-t border-border hover:bg-surface/40">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/data/metrics/${encodeURIComponent(t.name)}`}
                      className="absolute inset-0"
                      aria-label={`Open ${t.name}`}
                    />
                    {t.name}
                    {t.unit && <span className="text-muted"> ({t.unit})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {t.count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {t.lastAt ? formatShort(t.lastAt) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {q && (
        <div className="mt-2 text-[0.75rem] text-muted">
          {filtered.length} of {rows.length} metric{rows.length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
