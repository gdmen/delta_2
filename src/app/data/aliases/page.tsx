import { db } from "@/db";
import { metricTypeAliases, metricTypes } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { DataTabShell } from "@/components/data-tab-shell";
import { AliasRowDelete } from "./alias-row-delete";

export const dynamic = "force-dynamic";

/**
 * Aliases tab. Each row is `<alias> → <canonical metric_type name>`.
 * Aliases are populated by metric_type merges (the merged-away name
 * becomes an alias on the canonical) and by the orphan-first resolver
 * fallback. Deleting an alias here means future ingests of that name
 * fall back to auto-creating a `${source}:${rawName}` orphan instead
 * of routing here.
 */
export default async function AliasesPage() {
  const rows = await db
    .select({
      alias: metricTypeAliases.alias,
      canonicalId: metricTypeAliases.canonicalMetricTypeId,
      canonicalName: metricTypes.name,
      createdAt: metricTypeAliases.createdAt,
    })
    .from(metricTypeAliases)
    .innerJoin(metricTypes, eq(metricTypeAliases.canonicalMetricTypeId, metricTypes.id))
    .orderBy(asc(metricTypeAliases.alias));

  return (
    <DataTabShell
      active="aliases"
      description="Every alias → canonical metric_type mapping. Deleting an alias drops the redirect; the next ingest of that name will auto-create a fresh `${source}:${rawName}` orphan unless another alias catches it."
      label="Aliases"
      count={{ value: rows.length, unit: "rows" }}
    >
      {rows.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-6">
          No aliases yet. They appear automatically when you merge metric_types.
        </p>
      ) : (
        <div className="border border-border rounded">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-b border-border bg-surface/40">
                <th className="text-left font-mono font-normal text-muted text-[0.6875rem] uppercase tracking-wider px-3 py-2">
                  Alias
                </th>
                <th className="text-left font-mono font-normal text-muted text-[0.6875rem] uppercase tracking-wider px-3 py-2">
                  Canonical
                </th>
                <th className="text-left font-mono font-normal text-muted text-[0.6875rem] uppercase tracking-wider px-3 py-2">
                  Created
                </th>
                <th className="px-3 py-2 w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.alias} className="border-t border-border/40 first:border-t-0 hover:bg-surface/20">
                  <td className="px-3 py-2 font-mono">{r.alias}</td>
                  <td className="px-3 py-2 font-mono text-muted">→ {r.canonicalName}</td>
                  <td className="px-3 py-2 font-mono text-muted text-[0.75rem]">
                    {r.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <AliasRowDelete
                      alias={r.alias}
                      canonicalId={r.canonicalId}
                      canonicalName={r.canonicalName}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataTabShell>
  );
}
