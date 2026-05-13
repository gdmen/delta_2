import { db } from "@/db";
import { sports } from "@/db/schema";
import { asc } from "drizzle-orm";
import { findDuplicateCandidates } from "@/lib/duplicates/detector";
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
  const sportOptions = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(user.id).sports)
    .orderBy(asc(sports.name));

  return (
    <div className="max-w-[820px] space-y-10">
      <header>
        <h1 className="text-2xl font-semibold mb-1">Home</h1>
        <p className="text-[0.8125rem] text-muted">
          Quick review surface. More cards will land here over time.
        </p>
      </header>

      <SuggestedComposites pairs={pairs} sportOptions={sportOptions} />
    </div>
  );
}
