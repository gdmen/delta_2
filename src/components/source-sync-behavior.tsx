import { db } from "@/db";
import { sourceSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLastReconcile } from "@/lib/reconcile";
import { ReconcileToggle } from "./source-sync-behavior-client";

/**
 * Server component. Loads the per-source reconcile setting + last
 * reconcile log, renders a collapsed <details> block with the toggle.
 *
 * Mount on each data source's sub-page (Apple Health, Strava, BodySpec,
 * custom imports). Pass kind="csv" for custom CSV sources to surface the
 * extra "each upload is the full picture for its dates" line.
 */
export async function SourceSyncBehavior({
  source,
  kind = "third-party",
}: {
  source: string;
  kind?: "third-party" | "csv";
}) {
  const rows = await db
    .select()
    .from(sourceSettings)
    .where(eq(sourceSettings.source, source))
    .limit(1);
  const enabled = rows[0]?.reconcileEnabled === true;
  const last = await getLastReconcile(source);

  const csvLine =
    kind === "csv"
      ? "Each CSV you upload is treated as the full picture for the dates inside it. Uploading a CSV that covers only one month will affect that month but leave older data untouched."
      : undefined;

  return (
    <details className="mb-10 border-b border-border pb-6">
      <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
        Sync behavior
      </summary>
      <div className="mt-6">
        <ReconcileToggle
          source={source}
          initialEnabled={enabled}
          lastReconcile={last}
          csvLine={csvLine}
        />
      </div>
    </details>
  );
}
