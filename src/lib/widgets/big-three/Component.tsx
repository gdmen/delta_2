import { BigThree } from "@/components/big-three";
import { isDataDepError, type WidgetData } from "../types";
import { dataKey, type BigThreeData } from "./keys";
import type { BigThreeConfig } from "./schema";

/**
 * Wraps the existing client-side BigThree component (lb/kg toggle +
 * MetricTrend per lift). Color comes from the powerlifting sport row's
 * `sports.color` — whatever the user picked or had auto-assigned. Falls
 * back to a neutral gray when no powerlifting row exists.
 */
export function BigThreeComponent({
  config,
  data,
}: {
  config: BigThreeConfig;
  data: WidgetData;
}) {
  const raw = data.get(dataKey(config));
  if (isDataDepError(raw) || raw === undefined) {
    return (
      <p className="text-[0.875rem] text-muted py-2">No lift data yet.</p>
    );
  }
  const { color, lifts } = raw as BigThreeData;
  return <BigThree stats={lifts} sportColor={color} />;
}
