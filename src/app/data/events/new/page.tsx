import Link from "next/link";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NewEventForm } from "./form";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { buildTypeSuggestionsBySportId } from "@/lib/duplicates/type-catalog";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const user = await requireUserOrSignin();
  const sportsList = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(user.id).sports)
    .orderBy(asc(sports.name));

  // Distinct (sport, type) pairs feed the autocomplete on the Type input.
  // Keeping it server-side avoids a round-trip when the sport selector
  // changes; one query at single-user scale is negligible.
  const typesBySport = await buildTypeSuggestionsBySportId(user.id);

  return (
    <div className="max-w-[640px]">
      <Link href="/data/events" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← All events
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">New event</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Create the event shell. You can add workout sets and attached metrics
        after the event is saved.
      </p>
      <NewEventForm sports={sportsList} typesBySport={typesBySport} />
    </div>
  );
}
