import Link from "next/link";
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

  return (
    <div className="max-w-[1200px]">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Body Composition</h1>
        <Link
          href="/nutrition"
          className="text-[0.8125rem] text-muted hover:text-foreground"
        >
          Nutrition →
        </Link>
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Body Composition
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">full history</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MetricBlock title="Weight" series={weight} fallbackUnit="lb" />
          <MetricBlock title="Body Fat %" series={bodyFat} fallbackUnit="%" />
          <MetricBlock title="Lean Mass" series={leanMass} fallbackUnit="lb" />
          <MetricBlock title="Fat Mass" series={fatMass} fallbackUnit="lb" />
          <MetricBlock title="Bone Mineral Density" series={boneDensity} fallbackUnit="g/cm²" />
          <MetricBlock title="Visceral Fat" series={visceralFat} fallbackUnit="lb" />
        </div>
      </section>
    </div>
  );
}
