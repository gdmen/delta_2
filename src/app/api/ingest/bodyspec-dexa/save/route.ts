import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { upsertMetric } from "@/lib/ingest-service";
import { ReconcileTracker } from "@/lib/reconcile";

/**
 * POST /api/ingest/bodyspec-dexa/save
 *
 * Persists the user-reviewed values from the BodySpec extract step. All
 * fields are optional — null/undefined values skip rather than error so
 * the user can opt out of any field they don't trust by clearing it in
 * the review form.
 *
 * Every metric_type written here is `body_spec:*` — the source-prefix
 * pattern matches sports auto-import. The user can later alias-merge
 * `body_spec:bodyweight` into a canonical `bodyweight` via the existing
 * merge UI when other DEXA sources show up.
 *
 * Source IDs use the unprefixed canonical short name as the stem
 * (`bodyspec-2016-02-25-body_fat_pct`). This keeps the IDs stable even
 * as the metric_type names changed in this refactor — `upsertMetric`'s
 * source_id-keyed dedup means a re-upload UPDATEs in place rather than
 * creating duplicates. See the plan's Idempotency section for the full
 * argument.
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
 * One row per save-body field:
 *  - `metric`     : metric_types.name (always `body_spec:*` here).
 *  - `sourceIdKey`: the unprefixed canonical short name used in the
 *    `bodyspec-${date}-${sourceIdKey}` source_id stem. Kept stable across
 *    schema changes so existing rows from past saves match by source_id
 *    and get UPDATEd instead of duplicated.
 */
const FIELD_TO_METRIC: Record<FieldKey, { metric: string; sourceIdKey: string }> = {
  // Total composition + supplemental
  body_weight_lb: { metric: "body_spec:bodyweight", sourceIdKey: "bodyweight" },
  body_fat_pct: { metric: "body_spec:body_fat_pct", sourceIdKey: "body_fat_pct" },
  lean_mass_lb: { metric: "body_spec:lean_mass", sourceIdKey: "lean_mass" },
  fat_mass_lb: { metric: "body_spec:fat_mass", sourceIdKey: "fat_mass" },
  bone_mineral_content_lb: { metric: "body_spec:bone_mineral_content", sourceIdKey: "bone_mineral_content" },
  bone_mineral_density: { metric: "body_spec:bone_mineral_density", sourceIdKey: "bone_mineral_density" },
  visceral_fat_lb: { metric: "body_spec:visceral_fat_mass", sourceIdKey: "visceral_fat_mass" },
  vat_volume_in3: { metric: "body_spec:vat_volume", sourceIdKey: "vat_volume" },
  t_score: { metric: "body_spec:t_score", sourceIdKey: "t_score" },
  z_score: { metric: "body_spec:z_score", sourceIdKey: "z_score" },
  rmr_kcal: { metric: "body_spec:rmr_kcal", sourceIdKey: "rmr_kcal" },
  ag_ratio: { metric: "body_spec:ag_ratio", sourceIdKey: "ag_ratio" },
  height_in: { metric: "body_spec:height", sourceIdKey: "height" },

  // Regional
  arms_fat_pct: { metric: "body_spec:arms_fat_pct", sourceIdKey: "arms_fat_pct" },
  arms_total_mass_lb: { metric: "body_spec:arms_total_mass", sourceIdKey: "arms_total_mass" },
  arms_fat_mass_lb: { metric: "body_spec:arms_fat_mass", sourceIdKey: "arms_fat_mass" },
  arms_lean_mass_lb: { metric: "body_spec:arms_lean_mass", sourceIdKey: "arms_lean_mass" },
  arms_bmc_lb: { metric: "body_spec:arms_bmc", sourceIdKey: "arms_bmc" },
  legs_fat_pct: { metric: "body_spec:legs_fat_pct", sourceIdKey: "legs_fat_pct" },
  legs_total_mass_lb: { metric: "body_spec:legs_total_mass", sourceIdKey: "legs_total_mass" },
  legs_fat_mass_lb: { metric: "body_spec:legs_fat_mass", sourceIdKey: "legs_fat_mass" },
  legs_lean_mass_lb: { metric: "body_spec:legs_lean_mass", sourceIdKey: "legs_lean_mass" },
  legs_bmc_lb: { metric: "body_spec:legs_bmc", sourceIdKey: "legs_bmc" },
  trunk_fat_pct: { metric: "body_spec:trunk_fat_pct", sourceIdKey: "trunk_fat_pct" },
  trunk_total_mass_lb: { metric: "body_spec:trunk_total_mass", sourceIdKey: "trunk_total_mass" },
  trunk_fat_mass_lb: { metric: "body_spec:trunk_fat_mass", sourceIdKey: "trunk_fat_mass" },
  trunk_lean_mass_lb: { metric: "body_spec:trunk_lean_mass", sourceIdKey: "trunk_lean_mass" },
  trunk_bmc_lb: { metric: "body_spec:trunk_bmc", sourceIdKey: "trunk_bmc" },
  android_fat_pct: { metric: "body_spec:android_fat_pct", sourceIdKey: "android_fat_pct" },
  android_total_mass_lb: { metric: "body_spec:android_total_mass", sourceIdKey: "android_total_mass" },
  android_fat_mass_lb: { metric: "body_spec:android_fat_mass", sourceIdKey: "android_fat_mass" },
  android_lean_mass_lb: { metric: "body_spec:android_lean_mass", sourceIdKey: "android_lean_mass" },
  android_bmc_lb: { metric: "body_spec:android_bmc", sourceIdKey: "android_bmc" },
  gynoid_fat_pct: { metric: "body_spec:gynoid_fat_pct", sourceIdKey: "gynoid_fat_pct" },
  gynoid_total_mass_lb: { metric: "body_spec:gynoid_total_mass", sourceIdKey: "gynoid_total_mass" },
  gynoid_fat_mass_lb: { metric: "body_spec:gynoid_fat_mass", sourceIdKey: "gynoid_fat_mass" },
  gynoid_lean_mass_lb: { metric: "body_spec:gynoid_lean_mass", sourceIdKey: "gynoid_lean_mass" },
  gynoid_bmc_lb: { metric: "body_spec:gynoid_bmc", sourceIdKey: "gynoid_bmc" },

  // Per-region BMD
  head_bmd: { metric: "body_spec:head_bmd", sourceIdKey: "head_bmd" },
  arms_bmd: { metric: "body_spec:arms_bmd", sourceIdKey: "arms_bmd" },
  legs_bmd: { metric: "body_spec:legs_bmd", sourceIdKey: "legs_bmd" },
  trunk_bmd: { metric: "body_spec:trunk_bmd", sourceIdKey: "trunk_bmd" },
  ribs_bmd: { metric: "body_spec:ribs_bmd", sourceIdKey: "ribs_bmd" },
  spine_bmd: { metric: "body_spec:spine_bmd", sourceIdKey: "spine_bmd" },
  pelvis_bmd: { metric: "body_spec:pelvis_bmd", sourceIdKey: "pelvis_bmd" },

  // Muscle balance
  right_arm_lean_mass_lb: { metric: "body_spec:right_arm_lean_mass", sourceIdKey: "right_arm_lean_mass" },
  right_arm_fat_mass_lb: { metric: "body_spec:right_arm_fat_mass", sourceIdKey: "right_arm_fat_mass" },
  left_arm_lean_mass_lb: { metric: "body_spec:left_arm_lean_mass", sourceIdKey: "left_arm_lean_mass" },
  left_arm_fat_mass_lb: { metric: "body_spec:left_arm_fat_mass", sourceIdKey: "left_arm_fat_mass" },
  right_leg_lean_mass_lb: { metric: "body_spec:right_leg_lean_mass", sourceIdKey: "right_leg_lean_mass" },
  right_leg_fat_mass_lb: { metric: "body_spec:right_leg_fat_mass", sourceIdKey: "right_leg_fat_mass" },
  left_leg_lean_mass_lb: { metric: "body_spec:left_leg_lean_mass", sourceIdKey: "left_leg_lean_mass" },
  left_leg_fat_mass_lb: { metric: "body_spec:left_leg_fat_mass", sourceIdKey: "left_leg_fat_mass" },
};

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

  const allMetricTypes = await db.select().from(metricTypes);
  const typeByName = new Map(allMetricTypes.map((m) => [m.name, m.id]));

  const recordedAt = `${body.scan_date}T12:00:00Z`;
  const saved: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const tracker = new ReconcileTracker();

  for (const [field, { metric, sourceIdKey }] of Object.entries(FIELD_TO_METRIC) as Array<
    [FieldKey, (typeof FIELD_TO_METRIC)[FieldKey]]
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

    const typeId = typeByName.get(metric);
    if (!typeId) {
      errors.push(`${metric}: metric type missing from DB (run seed)`);
      continue;
    }

    try {
      const sourceId = `bodyspec-${body.scan_date}-${sourceIdKey}`;
      await upsertMetric({
        metricTypeId: typeId,
        value,
        recordedAt,
        source: "bodyspec_dexa",
        sourceId,
      });
      tracker.recordMetric(typeId, sourceId, recordedAt);
      saved.push(metric);
    } catch (err) {
      errors.push(`${metric}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const reconcile = await tracker.apply("bodyspec_dexa");

  return NextResponse.json({
    scanDate: body.scan_date,
    saved,
    skipped,
    errors,
    reconcile,
  });
}
