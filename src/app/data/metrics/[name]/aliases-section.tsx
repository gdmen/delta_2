import Link from "next/link";

interface Props {
  initialAliases: string[];
}

/**
 * "Aliases" section on the metric detail page. Lists every alias that
 * routes incoming ingest to this metric_type. Each alias links to the
 * merges page filtered to the merge that produced it — the alias was
 * born of a merge, so the merge entry is also where you go to undo
 * the routing.
 *
 * Server component now (was a client component when it had a Remove
 * button calling DELETE /api/metric-types/:id/aliases/:alias). The
 * delete endpoint was removed in favor of "undo the merge instead":
 * direct alias removal is a footgun (you can re-create an unmerged
 * orphan with no audit trail), and every alias is born of a merge
 * anyway.
 */
export function AliasesSection({ initialAliases }: Props) {
  if (initialAliases.length === 0) {
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

  return (
    <section className="mb-8">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-2">
        Aliases
      </h2>
      <p className="text-[0.8125rem] text-text-secondary mb-3">
        Raw import names that route incoming data here. To stop routing,
        undo the merge that created the alias.
      </p>
      <ul className="border border-border rounded divide-y divide-border">
        {initialAliases.map((alias) => (
          <li
            key={alias}
            className="flex items-center justify-between px-3 py-2 gap-3"
          >
            <code className="font-mono text-[0.8125rem] truncate">{alias}</code>
            <Link
              href={`/data/merges?alias=${encodeURIComponent(alias)}`}
              className="text-[0.75rem] text-muted hover:text-foreground"
            >
              Find merge →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
