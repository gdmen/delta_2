import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards, dashboardWidgets } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { addWidgetInput, serializeConfig } from "@/lib/dashboards/validation";
import { lookupWidget } from "@/lib/widgets/registry";
import { readJson } from "@/lib/dashboards/request";

interface Ctx {
  params: Promise<{ id: string }>;
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const dashboardId = parseId(idRaw);
  if (dashboardId === null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const r = await readJson(req);
  if (!r.ok) return r.response;
  const parsed = addWidgetInput.safeParse(r.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const def = lookupWidget(input.widgetType);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown widget type "${input.widgetType}".` },
      { status: 400 },
    );
  }

  // The palette POSTs without a config (the user hasn't picked one yet).
  // Fall back to the widget's defaultConfig so a fresh widget saves
  // cleanly; the user fills in real values via the settings drawer that
  // opens immediately after add.
  const isEmptyConfig =
    input.config === undefined ||
    input.config === null ||
    (typeof input.config === "object" &&
      !Array.isArray(input.config) &&
      Object.keys(input.config as Record<string, unknown>).length === 0);
  const configToValidate = isEmptyConfig ? def.defaultConfig : input.config;

  // Validate the widget's config against its own Zod schema.
  const configCheck = def.schema.safeParse(configToValidate);
  if (!configCheck.success) {
    return NextResponse.json(
      { error: `Widget config: ${configCheck.error.issues[0]?.message ?? "invalid."}` },
      { status: 400 },
    );
  }
  const serialized = serializeConfig(configCheck.data);
  if (!serialized.ok) {
    return NextResponse.json({ error: serialized.reason }, { status: 400 });
  }

  // 404 BEFORE the position lookup so a missing-dashboard request bails fast.
  const dash = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(eq(dashboards.id, dashboardId))
    .limit(1);
  if (dash.length === 0) {
    return NextResponse.json({ error: "Dashboard not found." }, { status: 404 });
  }

  // Position defaults to one past the current max for this dashboard, computed
  // atomically via SQL subquery so two simultaneous adds can't collide.
  const positionExpr = input.position !== undefined
    ? sql`${input.position}`
    : sql`(SELECT COALESCE(MAX(${dashboardWidgets.position}), -1) + 1 FROM ${dashboardWidgets} WHERE ${dashboardWidgets.dashboardId} = ${dashboardId})`;

  const inserted = await db
    .insert(dashboardWidgets)
    .values({
      dashboardId,
      widgetType: input.widgetType,
      config: serialized.json,
      body: input.body ?? null,
      gridX: input.gridX ?? 0,
      gridY: input.gridY ?? 0,
      gridW: input.gridW ?? def.defaultSize.w,
      gridH: input.gridH ?? def.defaultSize.h,
      position: positionExpr as unknown as number,
    })
    .returning();

  // Bump the dashboard's updated_at so list views reflect the change.
  await db
    .update(dashboards)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(eq(dashboards.id, dashboardId));

  return NextResponse.json({ widget: inserted[0] }, { status: 201 });
}
