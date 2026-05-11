#!/usr/bin/env tsx
/**
 * One-shot migration: rewrite every `dashboard_widgets.config_json`
 * entry that carries a scalar `windowDays: N` into the new tuple form
 * `windowDays: [-N + 1, 0]`.
 *
 * Semantics preserved: pre-migration `windowDays: 7` meant "last 7
 * days INCLUDING today" (today + the 6 calendar days before). Post-
 * migration `[-6, 0]` reads "from 6 days ago through today, both
 * inclusive" — same 7 calendar days.
 *
 *   pre: windowDays: 7   →   post: windowDays: [-6, 0]
 *   pre: windowDays: 30  →   post: windowDays: [-29, 0]
 *   pre: windowDays: 1   →   post: windowDays: [0, 0]   (today only)
 *
 * Widgets touched:
 *   - metric_block       (top-level `config.windowDays`)
 *   - metrics_grid       (per-cell `config.metrics[].windowDays`)
 *
 * Idempotent: if the field is already a tuple, the row is left alone.
 * Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-window-days-to-range.ts
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-window-days-to-range.ts --dry-run
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { dashboardWidgets } from "../src/db/schema";

interface MetricBlockConfig {
  windowDays?: unknown;
  [k: string]: unknown;
}

interface MetricsGridConfig {
  metrics?: Array<{ windowDays?: unknown; [k: string]: unknown } | null>;
  [k: string]: unknown;
}

function asScalarPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  return null;
}

function migrateMetricBlock(cfg: MetricBlockConfig): { changed: boolean } {
  const n = asScalarPositiveInt(cfg.windowDays);
  if (n === null) return { changed: false };
  cfg.windowDays = [-(n - 1), 0];
  return { changed: true };
}

function migrateMetricsGrid(cfg: MetricsGridConfig): { changed: boolean } {
  if (!Array.isArray(cfg.metrics)) return { changed: false };
  let changed = false;
  for (const cell of cfg.metrics) {
    if (!cell || typeof cell !== "object") continue;
    const n = asScalarPositiveInt(cell.windowDays);
    if (n === null) continue;
    cell.windowDays = [-(n - 1), 0];
    changed = true;
  }
  return { changed };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("[migrate] DRY RUN — no writes will be performed.");
  }

  const rows = await db
    .select({
      id: dashboardWidgets.id,
      widgetType: dashboardWidgets.widgetType,
      config: dashboardWidgets.config,
    })
    .from(dashboardWidgets);

  console.log(`[migrate] scanning ${rows.length} widget rows`);

  let touched = 0;
  let skipped = 0;
  for (const r of rows) {
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(r.config) as Record<string, unknown>;
    } catch (err) {
      console.warn(
        `[migrate] widget ${r.id} (${r.widgetType}): config_json is not valid JSON — skipping`,
        err instanceof Error ? err.message : String(err),
      );
      skipped++;
      continue;
    }

    let changed = false;
    if (r.widgetType === "metric_block") {
      changed = migrateMetricBlock(cfg as MetricBlockConfig).changed;
    } else if (r.widgetType === "metrics_grid") {
      changed = migrateMetricsGrid(cfg as MetricsGridConfig).changed;
    } else {
      continue;
    }

    if (!changed) continue;

    const newJson = JSON.stringify(cfg);
    console.log(
      `[migrate] widget ${r.id} (${r.widgetType}): rewriting windowDays`,
    );
    if (!dryRun) {
      await db
        .update(dashboardWidgets)
        .set({ config: newJson })
        .where(sql`${dashboardWidgets.id} = ${r.id}`);
    }
    touched++;
  }

  console.log(
    `[migrate] done: ${touched} rows ${dryRun ? "would be" : "were"} updated; ${skipped} skipped (invalid JSON)`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
