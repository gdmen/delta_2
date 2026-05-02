import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards, dashboardWidgets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { updateWidgetInput, serializeConfig } from "@/lib/dashboards/validation";
import { lookupWidget } from "@/lib/widgets/registry";
import { readJson } from "@/lib/dashboards/request";

interface Ctx {
  params: Promise<{ id: string; wid: string }>;
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id: idRaw, wid: widRaw } = await params;
  const dashboardId = parseId(idRaw);
  const widgetId = parseId(widRaw);
  if (dashboardId === null || widgetId === null) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const r = await readJson(req);
  if (!r.ok) return r.response;
  const parsed = updateWidgetInput.safeParse(r.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const existing = await db
    .select()
    .from(dashboardWidgets)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId)))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Widget not found." }, { status: 404 });
  }
  const widget = existing[0];

  // If config is being updated, validate it against the widget's schema.
  let configJson: string | undefined;
  if (input.config !== undefined) {
    const def = lookupWidget(widget.widgetType);
    if (!def) {
      return NextResponse.json(
        { error: `Widget type "${widget.widgetType}" is no longer registered.` },
        { status: 400 },
      );
    }
    const check = def.schema.safeParse(input.config);
    if (!check.success) {
      return NextResponse.json(
        { error: `Widget config: ${check.error.issues[0]?.message ?? "invalid."}` },
        { status: 400 },
      );
    }
    const serialized = serializeConfig(check.data);
    if (!serialized.ok) {
      return NextResponse.json({ error: serialized.reason }, { status: 400 });
    }
    configJson = serialized.json;
  }

  // Build the patch — only include fields the client actually sent.
  const patch: Record<string, unknown> = {};
  if (configJson !== undefined) patch.config = configJson;
  if (input.body !== undefined) patch.body = input.body;
  if (input.gridX !== undefined) patch.gridX = input.gridX;
  if (input.gridY !== undefined) patch.gridY = input.gridY;
  if (input.gridW !== undefined) patch.gridW = input.gridW;
  if (input.gridH !== undefined) patch.gridH = input.gridH;
  if (input.position !== undefined) patch.position = input.position;

  const updated = await db
    .update(dashboardWidgets)
    .set(patch)
    .where(eq(dashboardWidgets.id, widgetId))
    .returning();

  await db
    .update(dashboards)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(eq(dashboards.id, dashboardId));

  return NextResponse.json({ widget: updated[0] });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id: idRaw, wid: widRaw } = await params;
  const dashboardId = parseId(idRaw);
  const widgetId = parseId(widRaw);
  if (dashboardId === null || widgetId === null) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const existing = await db
    .select({ id: dashboardWidgets.id })
    .from(dashboardWidgets)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId)))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Widget not found." }, { status: 404 });
  }

  await db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, widgetId));
  await db
    .update(dashboards)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(eq(dashboards.id, dashboardId));

  return NextResponse.json({ ok: true });
}
