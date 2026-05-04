import { getBigThreeStats } from "@/lib/strength-metrics";
import type { DataDep } from "../types";
import { DATA_KEY, type BigThreeData } from "./keys";

export function bigThreeDataDeps(): DataDep[] {
  return [{ key: DATA_KEY, fetch: () => getBigThreeStats() as Promise<BigThreeData> }];
}
