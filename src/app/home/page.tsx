import { db } from "@/db";
import { activities } from "@/db/schema";
import { asc } from "drizzle-orm";
import { findDuplicateCandidates } from "@/lib/duplicates/detector";
import { buildTypeSuggestionsByActivityId } from "@/lib/duplicates/type-catalog";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { SuggestedComposites } from "./suggested-composites";

export const dynamic = "force-dynamic";

/**
 * Home page. v1 surfaces one card — duplicate-event candidates from
 * the last 14 days so the user can merge or dismiss as part of their
 * daily review. Future surfaces will add more cards (stale focuses,
 * goal nudges, anomaly alerts) — keep the page shape generic enough
 * to accept them.
 */
export default async function HomePage() {
  const user = await requireUserOrSignin();
  const pairs = await findDuplicateCandidates(user.id, { recent: true });
  const activityOptions = await db
    .select({ id: activities.id, name: activities.name })
    .from(activities)
    .where(userScope(user.id).activities)
    .orderBy(asc(activities.name));
  const typeSuggestionsByActivityId = await buildTypeSuggestionsByActivityId(user.id);

  // No page-level "Home" header — the sidebar's 🏠 Home pinned link is
  // sufficient identification. A soft date stamp orients the user
  // without redundantly naming the page. Cards below carry their own
  // section headers and are the actual content.
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-[820px] space-y-10">
      <p className="text-[0.75rem] font-mono uppercase tracking-wider text-muted">
        {today}
      </p>

      <SuggestedComposites
        pairs={pairs}
        activityOptions={activityOptions}
        typeSuggestionsByActivityId={typeSuggestionsByActivityId}
      />
    </div>
  );
}
