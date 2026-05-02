import { DATA_DEP_ERROR, type DataDep, type WidgetData } from "./types";

/**
 * Collect every widget's data deps into a single deduped map. Two widgets
 * declaring the same `key` share one fetch (e.g. two metric_block widgets
 * both asking for bench_1rm history hit the DB once).
 */
export function collectDataDeps(
  deps: DataDep[][],
): Map<string, () => Promise<unknown>> {
  const map = new Map<string, () => Promise<unknown>>();
  for (const list of deps) {
    for (const dep of list) {
      if (!map.has(dep.key)) {
        map.set(dep.key, dep.fetch);
      }
    }
  }
  return map;
}

/**
 * Run all deduped fetchers in parallel via Promise.allSettled and assemble
 * a Map<key, data | DataDepError>. Rejected fetchers store a sentinel so
 * downstream code can distinguish "fetcher errored" from "key not
 * requested" (both would otherwise look like `undefined`).
 *
 * Logs each rejection with its key so a failed fetch is debuggable from
 * the server console without crashing the whole dashboard render.
 */
export async function runDataDeps(
  deduped: Map<string, () => Promise<unknown>>,
): Promise<WidgetData> {
  const keys = [...deduped.keys()];
  const results = await Promise.allSettled(keys.map((k) => deduped.get(k)!()));
  const data: WidgetData = new Map();
  for (let i = 0; i < keys.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      data.set(keys[i], r.value);
    } else {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`[widgets] data fetch failed for key=${keys[i]}`, r.reason);
      data.set(keys[i], { kind: DATA_DEP_ERROR, message });
    }
  }
  return data;
}
