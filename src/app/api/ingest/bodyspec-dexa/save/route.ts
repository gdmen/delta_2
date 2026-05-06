import { NextRequest, NextResponse } from "next/server";
import { upsertMetric } from "@/lib/ingest-service";
import { ReconcileTracker } from "@/lib/reconcile";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
} from "@/lib/ingest/metric-resolver";

/**
 * POST /api/ingest/bodyspec-dexa/save
 *
 * Persists the user-reviewed values from the BodySpec extract step. All
 * fields are optional — null/undefined values skip rather than error so
 * the user can opt out of any field they don't trust by clearing it in
 * the review form.
 *
 * Each value resolves to a metric_types.id via the shared
 * `resolveMetricTypeId` helper — same path used by Strava, Apple Health,
 * and the CSV importer. That gives BodySpec the same name handling as
 * every other source:
 *
 *   1. Direct hit on `bodyspec_dexa:lean_mass` (the canonical orphan
 *      created on first import).
 *   2. Alias hit when the user has merged `bodyspec_dexa:lean_mass`
 *      into a canonical like `lean_mass` — the resolver routes to the
 *      canonical id automatically. (The original BodySpec save did a
 *      naive byName lookup that missed this case and silently dropped
 *      the field.)
 *   3. Auto-create the orphan if neither hit. No seed step needed; the
 *      first import populates the catalog organically, just like the
 *      other importers.
 *
 * Source IDs use the unprefixed canonical short name as the stem
 * (e.g., `bodyspec-2016-02-25-body_fat_pct`). Stable across re-imports
 * so `upsertMetric` UPDATEs the existing row instead of inserting a
 * duplicate.
 */

interface SaveBody {
  scan_date: string; // YYYY-MM-DD

  // Total composition + supplemental
  body_weight_lb?: number | null;
  body_fat_pct?: number | null;
  lean_mass_lb?: number | null;
  fat_mass_lb?: number | null;
  bone_mineral_content_lb?: number | null;
  bone_mineral_density?: number | null;
  visceral_fat_lb?: number | null;
  vat_volume_in3?: number | null;
  t_score?: number | null;
  z_score?: number | null;
  rmr_kcal?: number | null;
  ag_ratio?: number | null;
  height_in?: number | null;

  // Regional
  arms_fat_pct?: number | null;
  arms_total_mass_lb?: number | null;
  arms_fat_mass_lb?: number | null;
  arms_lean_mass_lb?: number | null;
  arms_bmc_lb?: number | null;
  legs_fat_pct?: number | null;
  legs_total_mass_lb?: number | null;
  legs_fat_mass_lb?: number | null;
  legs_lean_mass_lb?: number | null;
  legs_bmc_lb?: number | null;
  trunk_fat_pct?: number | null;
  trunk_total_mass_lb?: number | null;
  trunk_fat_mass_lb?: number | null;
  trunk_lean_mass_lb?: number | null;
  trunk_bmc_lb?: number | null;
  android_fat_pct?: number | null;
  android_total_mass_lb?: number | null;
  android_fat_mass_lb?: number | null;
  android_lean_mass_lb?: number | null;
  android_bmc_lb?: number | null;
  gynoid_fat_pct?: number | null;
  gynoid_total_mass_lb?: number | null;
  gynoid_fat_mass_lb?: number | null;
  gynoid_lean_mass_lb?: number | null;
  gynoid_bmc_lb?: number | null;

  // Per-region BMD
  head_bmd?: number | null;
  arms_bmd?: number | null;
  legs_bmd?: number | null;
  trunk_bmd?: number | null;
  ribs_bmd?: number | null;
  spine_bmd?: number | null;
  pelvis_bmd?: number | null;

  // Muscle balance
  right_arm_lean_mass_lb?: number | null;
  right_arm_fat_mass_lb?: number | null;
  left_arm_lean_mass_lb?: number | null;
  left_arm_fat_mass_lb?: number | null;
  right_leg_lean_mass_lb?: number | null;
  right_leg_fat_mass_lb?: number | null;
  left_leg_lean_mass_lb?: number | null;
  left_leg_fat_mass_lb?: number | null;
}

type FieldKey = keyof Omit<SaveBody, "scan_date">;

/**
 * SaveBody field key → { rawName, unit }.
 *  - rawName: unprefixed canonical short name. Doubles as the resolver's
 *    `rawName` and the source_id stem. The full metric_type name is
 *    `bodyspec_dexa:<rawName>`, built at resolution time so the prefix
 *    lives in exactly one place (SOURCE_SYSTEM below).
 *  - unit: passed to resolver's auto-create so freshly-minted rows have
 *    the right unit. Without this they default to "" and a later merge
 *    into a unit-bearing canonical (`lean_mass` → "lb") trips the
 *    unit-mismatch guard.
 */
const FIELD_TO_RAW: Record<FieldKey, { rawName: string; unit: string }> = {
  body_weight_lb: { rawName: "bodyweight", unit: "lb" },
  body_fat_pct: { rawName: "body_fat_pct", unit: "%" },
  lean_mass_lb: { rawName: "lean_mass", unit: "lb" },
  fat_mass_lb: { rawName: "fat_mass", unit: "lb" },
  bone_mineral_content_lb: { rawName: "bone_mineral_content", unit: "lb" },
  bone_mineral_density: { rawName: "bone_mineral_density", unit: "g/cm²" },
  visceral_fat_lb: { rawName: "visceral_fat_mass", unit: "lb" },
  vat_volume_in3: { rawName: "vat_volume", unit: "in³" },
  t_score: { rawName: "t_score", unit: "" },
  z_score: { rawName: "z_score", unit: "" },
  rmr_kcal: { rawName: "rmr_kcal", unit: "kcal/day" },
  ag_ratio: { rawName: "ag_ratio", unit: "" },
  height_in: { rawName: "height", unit: "in" },
  arms_fat_pct: { rawName: "arms_fat_pct", unit: "%" },
  arms_total_mass_lb: { rawName: "arms_total_mass", unit: "lb" },
  arms_fat_mass_lb: { rawName: "arms_fat_mass", unit: "lb" },
  arms_lean_mass_lb: { rawName: "arms_lean_mass", unit: "lb" },
  arms_bmc_lb: { rawName: "arms_bmc", unit: "lb" },
  legs_fat_pct: { rawName: "legs_fat_pct", unit: "%" },
  legs_total_mass_lb: { rawName: "legs_total_mass", unit: "lb" },
  legs_fat_mass_lb: { rawName: "legs_fat_mass", unit: "lb" },
  legs_lean_mass_lb: { rawName: "legs_lean_mass", unit: "lb" },
  legs_bmc_lb: { rawName: "legs_bmc", unit: "lb" },
  trunk_fat_pct: { rawName: "trunk_fat_pct", unit: "%" },
  trunk_total_mass_lb: { rawName: "trunk_total_mass", unit: "lb" },
  trunk_fat_mass_lb: { rawName: "trunk_fat_mass", unit: "lb" },
  trunk_lean_mass_lb: { rawName: "trunk_lean_mass", unit: "lb" },
  trunk_bmc_lb: { rawName: "trunk_bmc", unit: "lb" },
  android_fat_pct: { rawName: "android_fat_pct", unit: "%" },
  android_total_mass_lb: { rawName: "android_total_mass", unit: "lb" },
  android_fat_mass_lb: { rawName: "android_fat_mass", unit: "lb" },
  android_lean_mass_lb: { rawName: "android_lean_mass", unit: "lb" },
  android_bmc_lb: { rawName: "android_bmc", unit: "lb" },
  gynoid_fat_pct: { rawName: "gynoid_fat_pct", unit: "%" },
  gynoid_total_mass_lb: { rawName: "gynoid_total_mass", unit: "lb" },
  gynoid_fat_mass_lb: { rawName: "gynoid_fat_mass", unit: "lb" },
  gynoid_lean_mass_lb: { rawName: "gynoid_lean_mass", unit: "lb" },
  gynoid_bmc_lb: { rawName: "gynoid_bmc", unit: "lb" },
  head_bmd: { rawName: "head_bmd", unit: "g/cm²" },
  arms_bmd: { rawName: "arms_bmd", unit: "g/cm²" },
  legs_bmd: { rawName: "legs_bmd", unit: "g/cm²" },
  trunk_bmd: { rawName: "trunk_bmd", unit: "g/cm²" },
  ribs_bmd: { rawName: "ribs_bmd", unit: "g/cm²" },
  spine_bmd: { rawName: "spine_bmd", unit: "g/cm²" },
  pelvis_bmd: { rawName: "pelvis_bmd", unit: "g/cm²" },
  right_arm_lean_mass_lb: { rawName: "right_arm_lean_mass", unit: "lb" },
  right_arm_fat_mass_lb: { rawName: "right_arm_fat_mass", unit: "lb" },
  left_arm_lean_mass_lb: { rawName: "left_arm_lean_mass", unit: "lb" },
  left_arm_fat_mass_lb: { rawName: "left_arm_fat_mass", unit: "lb" },
  right_leg_lean_mass_lb: { rawName: "right_leg_lean_mass", unit: "lb" },
  right_leg_fat_mass_lb: { rawName: "right_leg_fat_mass", unit: "lb" },
  left_leg_lean_mass_lb: { rawName: "left_leg_lean_mass", unit: "lb" },
  left_leg_fat_mass_lb: { rawName: "left_leg_fat_mass", unit: "lb" },
};

// Source value on the metrics row AND the metric_type prefix. They match
// — same convention as `apple_health:*` / `strava:*` / per-CSV.
const SOURCE_SYSTEM = "bodyspec_dexa";

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.scan_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.scan_date)) {
    return NextResponse.json({ error: "scan_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const cache = await buildMetricTypeCache();
  const recordedAt = `${body.scan_date}T12:00:00Z`;
  const saved: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const tracker = new ReconcileTracker();

  for (const [field, { rawName, unit }] of Object.entries(FIELD_TO_RAW) as Array<
    [FieldKey, (typeof FIELD_TO_RAW)[FieldKey]]
  >) {
    const value = body[field];
    if (value === null || value === undefined) {
      skipped.push(`${field} (no value)`);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field}: not a finite number`);
      continue;
    }

    try {
      // Resolver: direct → alias → auto-create. The map points the raw
      // name at the prefixed canonical so a populated catalog hits
      // directly; merges + cold runs route through the alias and
      // auto-create paths respectively. Unit lands on auto-created rows
      // so a later merge into a unit-bearing canonical doesn't trip the
      // unit-mismatch guard.
      const typeId = await resolveMetricTypeId({
        rawName,
        map: { [rawName]: `${SOURCE_SYSTEM}:${rawName}` },
        sourceSystem: SOURCE_SYSTEM,
        unit,
        cache,
      });

      const sourceId = `bodyspec-${body.scan_date}-${rawName}`;
      await upsertMetric({
        metricTypeId: typeId,
        value,
        recordedAt,
        source: SOURCE_SYSTEM,
        sourceId,
      });
      tracker.recordMetric(typeId, sourceId, recordedAt);
      saved.push(rawName);
    } catch (err) {
      errors.push(`${rawName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const reconcile = await tracker.apply(SOURCE_SYSTEM);

  return NextResponse.json({
    scanDate: body.scan_date,
    saved,
    skipped,
    errors,
    reconcile,
  });
}
