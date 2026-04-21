import { getLastDays } from "@/lib/metric-history";
import { MetricBlock } from "@/components/metric-block";

export const dynamic = "force-dynamic";

/**
 * Daily nutrition compliance. Unlike body composition (occasional
 * measurements benefit from full history), nutrition is a daily
 * rolling-window view - you care about what you've done recently and
 * whether you're hitting targets, not whether you ate a lot of fiber in
 * 2019.
 */
export default async function NutritionPage() {
  const [protein, water, fiber] = await Promise.all([
    getLastDays("protein_g", 30),
    getLastDays("water_oz", 30),
    getLastDays("fiber_g", 30),
  ]);

  return (
    <div className="max-w-[1200px]">
      <h1 className="text-2xl font-semibold mb-8">Nutrition</h1>

      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Daily intake
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">last 30 days</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MetricBlock title="Protein" series={protein} fallbackUnit="g" target={180} window="30d" />
          <MetricBlock title="Water" series={water} fallbackUnit="oz" target={100} window="30d" />
          <MetricBlock title="Fiber" series={fiber} fallbackUnit="g" target={30} window="30d" />
        </div>
      </section>
    </div>
  );
}
