import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { upsertMetric } from "@/lib/ingest-service";

interface SaveBody {
  scan_date: string; // YYYY-MM-DD
  body_weight_lb?: number | null;
  body_fat_pct?: number | null;
  lean_mass_lb?: number | null;
  fat_mass_lb?: number | null;
  bone_mineral_density?: number | null;
  visceral_fat_lb?: number | null;
}

// Map confirmed fields to our metric_types.name + value.
const FIELD_TO_METRIC: Record<keyof Omit<SaveBody, "scan_date">, string> = {
  body_weight_lb: "bodyweight",
  body_fat_pct: "body_fat_pct",
  lean_mass_lb: "lean_mass",
  fat_mass_lb: "fat_mass",
  bone_mineral_density: "bone_mineral_density",
  visceral_fat_lb: "visceral_fat_mass",
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

  for (const [field, metricName] of Object.entries(FIELD_TO_METRIC) as Array<[keyof typeof FIELD_TO_METRIC, string]>) {
    const value = body[field];
    if (value === null || value === undefined) {
      skipped.push(`${field} (no value)`);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field}: not a finite number`);
      continue;
    }

    const typeId = typeByName.get(metricName);
    if (!typeId) {
      errors.push(`${metricName}: metric type missing from DB`);
      continue;
    }

    try {
      await upsertMetric({
        metricTypeId: typeId,
        value,
        recordedAt,
        source: "bodyspec_dexa",
        sourceId: `bodyspec-${body.scan_date}-${metricName}`,
      });
      saved.push(metricName);
    } catch (err) {
      errors.push(`${metricName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    scanDate: body.scan_date,
    saved,
    skipped,
    errors,
  });
}
