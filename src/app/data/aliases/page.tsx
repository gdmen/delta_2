import Link from "next/link";
import { db } from "@/db";
import { metricTypeAliases, metricTypes } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

/**
 * Aliases tab. Each row is `<alias> → <canonical metric_type name>`,
 * sorted by alias.
 *
 * Aliases are populated by metric_type merges (the merged-away name
 * becomes an alias on the canonical) — there's no "create alias"
 * surface, every row was born of a merge. So removing an alias is
 * conceptually "undo the merge that created it." The Find-merge link
 * deep-links to /data/merges filtered to that alias.
 */
export default async function AliasesPage() {
  const rows = await db
    .select({
      alias: metricTypeAliases.alias,
      canonicalName: metricTypes.name,
      createdAt: metricTypeAliases.createdAt,
    })
    .from(metricTypeAliases)
    .innerJoin(metricTypes, eq(metricTypeAliases.canonicalMetricTypeId, metricTypes.id))
    .orderBy(asc(metricTypeAliases.alias));

  return (
    <DataTabShell
      active="aliases"
      description="Every alias → canonical metric_type mapping. Aliases come from merges; click one to find the merge that created it."
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.alias}
                  className="border-t border-border/40 first:border-t-0 hover:bg-surface/20"
                >
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/data/merges?alias=${encodeURIComponent(r.alias)}`}
                      className="hover:underline"
                      title="Find the merge that created this alias"
                    >
                      {r.alias}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-muted">
                    → {r.canonicalName}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted text-[0.75rem]">
                    {r.createdAt.slice(0, 10)}
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
