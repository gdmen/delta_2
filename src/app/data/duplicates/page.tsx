import Link from "next/link";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { asc } from "drizzle-orm";
import {
  findDuplicateCandidates,
  groupCandidates,
} from "@/lib/duplicates/detector";
import { buildTypeSuggestionsByActivityId } from "@/lib/duplicates/type-catalog";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { DuplicatesView } from "./view";

export const dynamic = "force-dynamic";

/**
 * Full candidate list with grouped bulk-dismiss. /home surfaces only
 * the recent (14d) subset; this page is the cleanup queue for older
 * pairs and for the post-import backfill wave.
 */
export default async function DuplicatesPage() {
  const user = await requireUserOrSignin();
  // No limit: this cleanup queue needs every pair so the grouped table is
  // complete and dismissing a group is monotonic (no truncation churn).
  const pairs = await findDuplicateCandidates(user.id, {
    recent: false,
    limit: null,
  });
  const groups = groupCandidates(pairs);
  const activityOptions = await db
    .select({ id: activities.id, name: activities.name })
    .from(activities)
    .where(userScope(user.id).activities)
    .orderBy(asc(activities.name));
  const typeSuggestionsByActivityId = await buildTypeSuggestionsByActivityId(user.id);

  return (
    <div className="max-w-[820px]">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Duplicate candidates</h1>
        <p className="text-[0.8125rem] text-muted">
          Cross-source events within 60 minutes of each other. Most are
          unrelated workouts on the same day; use the per-group bulk
          dismiss to clean up patterns you don&apos;t care about. The{" "}
          <Link href="/home" className="underline hover:text-foreground">
            home page
          </Link>{" "}
          surfaces just the last 14 days.
        </p>
      </header>

      <DuplicatesView
        pairs={pairs}
        groups={groups}
        activityOptions={activityOptions}
        typeSuggestionsByActivityId={typeSuggestionsByActivityId}
      />
    </div>
  );
}
