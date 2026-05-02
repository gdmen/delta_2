import { z } from "zod";
import { slugSchema } from "./slug";

/**
 * Shared validation schemas for the dashboard + widget mutation routes.
 * All bounds match the constraints documented in
 * docs/designs/configurable-dashboards.md.
 */

const positiveInt = z.number().int().nonnegative();

/** 12-col grid: x in [0,11], w in [1,12]. */
const gridX = z.number().int().min(0).max(11);
const gridY = positiveInt;
const gridW = z.number().int().min(1).max(12);
/** Practical cap so a widget can't take 1000 row-spans of vertical space. */
const gridH = z.number().int().min(1).max(50);

export const createDashboardInput = z.object({
  name: z.string().trim().min(1).max(255),
  slug: slugSchema.optional(),
  icon: z.string().max(32).optional(),
  sportId: z.number().int().positive().nullable().optional(),
  position: positiveInt.optional(),
});

export const updateDashboardInput = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    slug: slugSchema.optional(),
    icon: z.string().max(32).nullable().optional(),
    sportId: z.number().int().positive().nullable().optional(),
    position: positiveInt.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

export const addWidgetInput = z.object({
  widgetType: z.string().min(1),
  config: z.unknown().default({}),
  body: z.string().nullable().optional(),
  gridX: gridX.optional(),
  gridY: gridY.optional(),
  gridW: gridW.optional(),
  gridH: gridH.optional(),
  position: positiveInt.optional(),
});

export const updateWidgetInput = z
  .object({
    config: z.unknown().optional(),
    body: z.string().nullable().optional(),
    gridX: gridX.optional(),
    gridY: gridY.optional(),
    gridW: gridW.optional(),
    gridH: gridH.optional(),
    position: positiveInt.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

export const batchLayoutInput = z.object({
  widgets: z
    .array(
      z.object({
        id: z.number().int().positive(),
        gridX,
        gridY,
        gridW,
        gridH,
      }),
    )
    .min(1)
    .max(64),
});

/**
 * 4KB cap on serialized config JSON. Larger payloads belong in the
 * dashboard_widgets.body column (which has no cap). Matches the bound
 * documented in the security section of the design doc.
 */
export const CONFIG_MAX_BYTES = 4096;

export function serializeConfig(config: unknown): { ok: true; json: string } | { ok: false; reason: string } {
  let json: string;
  try {
    json = JSON.stringify(config ?? {});
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Config is not JSON-serializable." };
  }
  if (Buffer.byteLength(json, "utf8") > CONFIG_MAX_BYTES) {
    return { ok: false, reason: `Config exceeds ${CONFIG_MAX_BYTES}-byte limit.` };
  }
  return { ok: true, json };
}

export type CreateDashboardInput = z.infer<typeof createDashboardInput>;
export type UpdateDashboardInput = z.infer<typeof updateDashboardInput>;
export type AddWidgetInput = z.infer<typeof addWidgetInput>;
export type UpdateWidgetInput = z.infer<typeof updateWidgetInput>;
export type BatchLayoutInput = z.infer<typeof batchLayoutInput>;
