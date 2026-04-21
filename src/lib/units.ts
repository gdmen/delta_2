/**
 * Display helpers for weights stored as lb in the DB. Storage is
 * full-precision; display rounds per-unit to gym-realistic increments
 * (0.5 lb / 0.5 kg) so kg <-> lb round-trips look clean to the user.
 */

import { LB_PER_KG } from "./import-mapping";

export type WeightUnit = "lb" | "kg";

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** Round to nearest 0.5 in the chosen display unit. */
export function displayWeight(lbValue: number, unit: WeightUnit): string {
  const v = unit === "kg" ? lbToKg(lbValue) : lbValue;
  const rounded = Math.round(v * 2) / 2;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}
