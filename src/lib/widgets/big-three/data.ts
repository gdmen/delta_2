import { getBigThreeStats } from "@/lib/strength-metrics";
import type { DataDep } from "../types";
import { dataKey, type BigThreeData } from "./keys";
import type { BigThreeConfig } from "./schema";

export function bigThreeDataDeps(config: BigThreeConfig, userId: number): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () =>
        getBigThreeStats(
          {
            squat: config.squat,
            bench: config.bench,
            deadlift: config.deadlift,
          },
          userId,
        ) as Promise<BigThreeData>,
    },
  ];
}
