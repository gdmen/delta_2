import { getAllHistory } from "@/lib/metric-history";
import { MetricBlock } from "@/components/metric-block";

export const dynamic = "force-dynamic";

export default async function BodyCompPage() {
  // DEXA + bodyweight. These are occasional/periodic measurements so the
  // full-history view is what you want.
  const [weight, bodyFat, leanMass, fatMass, boneDensity, visceralFat] = await Promise.all([
    getAllHistory("bodyweight"),
    getAllHistory("body_fat_pct"),
    getAllHistory("lean_mass"),
    getAllHistory("fat_mass"),
    getAllHistory("bone_mineral_density"),
    getAllHistory("visceral_fat_mass"),
  ]);

  const allSeries = [weight, bodyFat, leanMass, fatMass, boneDensity, visceralFat];
  const sharedRange = unionRange(allSeries);

  return (
    <div className="max-w-[1200px]">
      <h1 className="text-2xl font-semibold mb-8">Body Composition</h1>

      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Body Composition
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">full history</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MetricBlock title="Weight" series={weight} fallbackUnit="lb" xMin={sharedRange?.min} xMax={sharedRange?.max} />
          <MetricBlock title="Body Fat %" series={bodyFat} fallbackUnit="%" xMin={sharedRange?.min} xMax={sharedRange?.max} />
          <MetricBlock title="Lean Mass" series={leanMass} fallbackUnit="lb" xMin={sharedRange?.min} xMax={sharedRange?.max} />
          <MetricBlock title="Fat Mass" series={fatMass} fallbackUnit="lb" xMin={sharedRange?.min} xMax={sharedRange?.max} />
          <MetricBlock title="Bone Mineral Density" series={boneDensity} fallbackUnit="g/cm²" xMin={sharedRange?.min} xMax={sharedRange?.max} />
          <MetricBlock title="Visceral Fat" series={visceralFat} fallbackUnit="lb" xMin={sharedRange?.min} xMax={sharedRange?.max} />
        </div>
      </section>
    </div>
  );
}

function unionRange(seriesList: { samples: { date: string }[] }[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of seriesList) {
    for (const sample of s.samples) {
      const ts = new Date(sample.date).getTime();
      if (Number.isFinite(ts)) {
        if (ts < min) min = ts;
        if (ts > max) max = ts;
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
