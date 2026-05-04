import { BigThree } from "@/components/big-three";
import { isDataDepError, type WidgetData } from "../types";
import { DATA_KEY, type BigThreeData } from "./keys";
import type { BigThreeConfig } from "./schema";

const POWERLIFTING_COLOR = "#dc2626";

/**
 * Wraps the existing client-side BigThree component (lb/kg toggle +
 * MetricTrend per lift). Color stays hardcoded to powerlifting red since
 * Big-3 is sport-specific and the dashboard isn't sport-scoped.
 */
export function BigThreeComponent({
  data,
}: {
  config: BigThreeConfig;
  data: WidgetData;
}) {
  const raw = data.get(DATA_KEY);
  if (isDataDepError(raw) || raw === undefined) {
    return (
      <p className="text-[0.875rem] text-muted py-2">No lift data yet.</p>
    );
  }
  return <BigThree stats={raw as BigThreeData} sportColor={POWERLIFTING_COLOR} />;
}
