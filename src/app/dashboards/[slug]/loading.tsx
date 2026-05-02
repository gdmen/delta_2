import { DashboardGrid } from "@/components/dashboards/DashboardGrid";

/**
 * Skeleton during initial route fetch. Six widget-shaped boxes pulsing
 * gently. No spinner — Delta inherits Linear-style calm.
 */
export default function DashboardLoading() {
  return (
    <div>
      <div className="h-8 w-48 bg-surface rounded animate-pulse mb-6" aria-hidden />
      <DashboardGrid>
        <SkeletonCell w={12} h={1} />
        <SkeletonCell w={6} h={3} />
        <SkeletonCell w={6} h={3} />
        <SkeletonCell w={4} h={2} />
        <SkeletonCell w={4} h={2} />
        <SkeletonCell w={4} h={2} />
      </DashboardGrid>
    </div>
  );
}

function SkeletonCell({ w, h }: { w: number; h: number }) {
  return (
    <div
      style={{ gridColumn: `span ${w}`, gridRow: `span ${h}` }}
      className="border border-border rounded-md bg-surface animate-pulse"
      aria-hidden
    />
  );
}
