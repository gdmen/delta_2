import { db } from "@/db";
import { activities, events, focuses, goals } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ActivitiesTable } from "./activities-table";
import { DataTabShell } from "@/components/data-tab-shell";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

/**
 * Orphan = name carries a `<source>:<rawName>` prefix from auto-import.
 * Detected purely by the colon — any prefix counts (strava, apple_health,
 * bodyspec, future sources). Canonical activity names don't include colons.
 */
function isOrphanName(name: string): boolean {
  return name.includes(":");
}

/** Strip the `<source>:` prefix to recover the raw label. */
function suffixOf(name: string): string {
  const idx = name.indexOf(":");
  return idx === -1 ? name : name.slice(idx + 1);
}

export default async function ActivitiesPage() {
  const user = await requireUserOrSignin();
  // One round-trip: left-join each dependent table, aggregate in SQL.
  // focus/goal counts need COUNT(DISTINCT) because the joins multiply.
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      color: activities.color,
      eventCount: sql<number>`COUNT(DISTINCT ${events.id})`,
      focusCount: sql<number>`COUNT(DISTINCT ${focuses.id})`,
      goalCount: sql<number>`COUNT(DISTINCT ${goals.id})`,
      lastEventAt: sql<string>`MAX(${events.startedAt})`,
    })
    .from(activities)
    .leftJoin(events, and(userScope(user.id).events, eq(events.activityId, activities.id)))
    .leftJoin(goals, and(userScope(user.id).goals, eq(goals.activityId, activities.id)))
    // Focuses now reach their activity via the goal, not a direct activity_id.
    // Count only manual focuses — un-promoted LLM proposals shouldn't
    // inflate the "you have N focuses" thumb-rule.
    .leftJoin(
      focuses,
      and(eq(focuses.goalId, goals.id), eq(focuses.source, "manual")),
    )
    .where(userScope(user.id).activities)
    .groupBy(activities.id)
    .orderBy(sql`COUNT(DISTINCT ${events.id}) DESC`);

  // Build a case-insensitive lookup of canonical (non-orphan) names so we
  // can suggest a merge target for orphans whose suffix matches one. Cheap:
  // activities table is small and we already have it in memory.
  const canonicalByLower = new Map<string, { id: number; name: string }>();
  for (const r of rows) {
    if (!isOrphanName(r.name)) {
      canonicalByLower.set(r.name.toLowerCase(), { id: r.id, name: r.name });
    }
  }

  const data = rows.map((r) => {
    const orphan = isOrphanName(r.name);
    // Suggested merge target: orphan whose suffix (case-folded) matches an
    // existing canonical. e.g. `strava:Running` -> suggest `running` if the
    // user already has it. Returns null when no match — the user merges by
    // hand the first time, the second source's matching orphan auto-suggests.
    const suggestion =
      orphan
        ? canonicalByLower.get(suffixOf(r.name).toLowerCase()) ?? null
        : null;
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      eventCount: Number(r.eventCount),
      focusCount: Number(r.focusCount),
      goalCount: Number(r.goalCount),
      lastEventAt: r.lastEventAt,
      isOrphan: orphan,
      suggestedTarget: suggestion,
    };
  });

  const orphanCount = data.filter((r) => r.isOrphan).length;

  return (
    <DataTabShell
      active="activities"
      description="Every row Delta has stored. Click through to manage activity-attached events, goals, and focuses — or merge duplicates with the selection tools here."
      label="Activities"
      count={{ value: data.length, unit: data.length === 1 ? "activity" : "activities" }}
    >
      {orphanCount > 0 && (
        <div className="mb-3 text-[0.6875rem] font-mono text-accent-orange">
          {orphanCount} unmerged
          <span className="text-muted">
            {" "}
            — auto-created from imports. Tagged{" "}
            <span className="text-accent-orange">auto</span> below; matching
            canonicals get a → suggestion. Select two or more rows to merge.
          </span>
        </div>
      )}
      <ActivitiesTable rows={data} />
    </DataTabShell>
  );
}
