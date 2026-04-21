import Link from "next/link";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NewEventForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const sportsList = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .orderBy(asc(sports.name));

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
      <NewEventForm sports={sportsList} />
    </div>
  );
}
