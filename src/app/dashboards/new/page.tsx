import { db } from "@/db";
import { activities } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NewDashboardForm } from "./NewDashboardForm";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function NewDashboardPage() {
  const user = await requireUserOrSignin();
  const activityRows = await db
    .select({ id: activities.id, name: activities.name, color: activities.color })
    .from(activities)
    .where(userScope(user.id).activities)
    .orderBy(asc(activities.name));

  return (
    <div className="max-w-[36rem]">
      <h1 className="text-2xl font-semibold mb-2">New dashboard</h1>
      <p className="text-[0.875rem] text-muted mb-6">
        A dashboard is a named layout of widgets. Pick a name and optionally a
        activity color. You&apos;ll add widgets after it&apos;s created.
      </p>
      <NewDashboardForm activities={activityRows} />
    </div>
  );
}
