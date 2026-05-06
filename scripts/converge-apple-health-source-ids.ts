/**
 * One-shot script: rewrite apple_health source_ids to the new
 * raw-name-stemmed format and consolidate any duplicate rows that
 * arose from the pre-fix bug.
 *
 * Background. The Apple Health save endpoint used to stem the source_id
 * on the resolved metric_type name:
 *   `hae-${canonicalName}-${iso}`
 *
 * That string changed when the user merged a `apple_health:<rawName>`
 * orphan into a canonical, so the next ingest produced a NEW source_id
 * for the same datapoint — INSERTing a duplicate instead of UPDATEing.
 *
 * This script walks every `apple_health:<rawName>` alias, finds metrics
 * rows under each canonical, picks ONE preferred raw name per canonical
 * (alphabetical first when multiple aliases point at the same target),
 * rewrites every row's source_id to `hae-${preferred}-${recordedAt}`,
 * and deletes duplicate-pair losers. After this, the new code path
 * emits matching source_ids and `upsertMetric` UPDATEs in place.
 *
 * Multi-alias edge case: when HAE has shipped two raw names for the
 * same metric over time (e.g. `protein` and `dietary_protein` both
 * merged into `protein`), the script collapses everything onto the
 * alphabetical-first alias name. If HAE pushes the OTHER name in a
 * future export, a new row appears with the unmerged raw name; user
 * re-runs this script to re-fold. Idempotent.
 *
 * Usage:
 *   npx tsx scripts/converge-apple-health-source-ids.ts
 */
import { db } from "@/db";
import { metricTypeAliases, metrics } from "@/db/schema";
import { and, eq, like } from "drizzle-orm";

const ALIAS_PREFIX = "apple_health:";

async function main() {
  const aliases = await db
    .select({
      alias: metricTypeAliases.alias,
      canonicalId: metricTypeAliases.canonicalMetricTypeId,
    })
    .from(metricTypeAliases)
    .where(like(metricTypeAliases.alias, `${ALIAS_PREFIX}%`));

  // Group raw names by canonical id, then pick alphabetical-first as the
  // preferred name. Multiple aliases pointing at the same canonical (e.g.
  // both `apple_health:protein` and `apple_health:dietary_protein` →
  // canonical `protein`) would otherwise ping-pong on each pass.
  const byCanonical = new Map<number, string[]>();
  for (const { alias, canonicalId } of aliases) {
    const rawName = alias.substring(ALIAS_PREFIX.length);
    const list = byCanonical.get(canonicalId) ?? [];
    list.push(rawName);
    byCanonical.set(canonicalId, list);
  }

  console.log(
    `Found ${aliases.length} apple_health: aliases across ${byCanonical.size} canonical metric_types.`,
  );

  let touched = 0;
  let renamed = 0;
  let dedup = 0;

  for (const [canonicalId, rawNames] of byCanonical) {
    rawNames.sort(); // deterministic preferred-name selection
    const preferred = rawNames[0];

    const rows = await db
      .select({
        id: metrics.id,
        sourceId: metrics.sourceId,
        recordedAt: metrics.recordedAt,
      })
      .from(metrics)
      .where(
        and(eq(metrics.source, "apple_health"), eq(metrics.metricTypeId, canonicalId)),
      );

    let perCanonRenamed = 0;
    let perCanonDedup = 0;

    for (const row of rows) {
      const target = `hae-${preferred}-${row.recordedAt}`;
      if (row.sourceId === target) continue; // already converged
      touched++;

      // Look for an existing row that already holds the target source_id
      // at this metric_type. If one is there (and it's not us), it's the
      // duplicate-pair winner; drop our row.
      const collision = await db
        .select({ id: metrics.id })
        .from(metrics)
        .where(
          and(
            eq(metrics.source, "apple_health"),
            eq(metrics.metricTypeId, canonicalId),
            eq(metrics.sourceId, target),
          ),
        )
        .limit(1);

      if (collision.length > 0 && collision[0].id !== row.id) {
        await db.delete(metrics).where(eq(metrics.id, row.id));
        dedup++;
        perCanonDedup++;
      } else {
        await db
          .update(metrics)
          .set({ sourceId: target })
          .where(eq(metrics.id, row.id));
        renamed++;
        perCanonRenamed++;
      }
    }

    if (rows.length > 0) {
      const aliasNote =
        rawNames.length > 1
          ? ` (preferred from [${rawNames.join(", ")}])`
          : "";
      console.log(
        `  canonical id=${canonicalId}: ${rows.length} rows, target stem hae-${preferred}-${aliasNote} — renamed ${perCanonRenamed}, dedup'd ${perCanonDedup}`,
      );
    }
  }

  console.log(
    `Done. touched=${touched}, renamed=${renamed}, dedup'd=${dedup}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
