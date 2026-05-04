import type { LiftStats } from "@/lib/strength-metrics";

export const DATA_KEY = "big_three:stats";

export type BigThreeData = Record<LiftStats["lift"], LiftStats>;
