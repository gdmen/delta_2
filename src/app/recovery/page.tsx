import { getLastDays } from "@/lib/metric-history";
import { MetricBlock } from "@/components/metric-block";

export const dynamic = "force-dynamic";

/**
 * Recovery: the daily inputs that determine how well you bounce back
 * between training sessions. Rolling-window view (last 30 days) - you
 * care about recent compliance, not history.
 */
export default async function RecoveryPage() {
  const [sleep, protein, water, fiber] = await Promise.all([
    getLastDays("sleep_hours", 30),
    getLastDays("protein_g", 30),
    getLastDays("water_oz", 30),
    getLastDays("fiber_g", 30),
  ]);

  return (
    <div className="max-w-[1200px]">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Recovery</h1>
        <span className="font-mono text-[0.6875rem] text-muted">last 30 days</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <MetricBlock title="Sleep" series={sleep} fallbackUnit="h" target={8} window="30d" />
        <MetricBlock title="Protein" series={protein} fallbackUnit="g" target={180} window="30d" />
        <MetricBlock title="Water" series={water} fallbackUnit="oz" target={100} window="30d" />
        <MetricBlock title="Fiber" series={fiber} fallbackUnit="g" target={30} window="30d" />
      </div>
    </div>
  );
}
