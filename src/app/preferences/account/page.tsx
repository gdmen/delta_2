import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, ingestConfigs } from "@/db/schema";
import { requireUserOrSignin } from "@/lib/auth/require";
import { ingestUrl } from "@/lib/site-url";
import { AccountForm } from "./form";

/**
 * /preferences/account — change password, regenerate HAE key, delete
 * account. Owner can't self-delete (the DELETE handler refuses with
 * 403); the UI hides the button for them too.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUserOrSignin();

  const fullUser = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isOwner: users.isOwner,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const me = fullUser[0]!;
  const hasPassword = me.passwordHash !== null && me.passwordHash !== "!";

  const haeRow = await db
    .select({ enabled: ingestConfigs.enabled })
    .from(ingestConfigs)
    .where(eq(ingestConfigs.userId, user.id))
    .limit(1);
  const hasHaeKey = haeRow.length > 0;

  return (
    <div className="max-w-[640px]">
      <h1 className="text-2xl font-semibold mb-2">Account</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        {me.displayName} · {me.email ?? "no email"}
        {me.isOwner ? " · owner" : ""}
      </p>

      <AccountForm
        hasPassword={hasPassword}
        hasHaeKey={hasHaeKey}
        isOwner={me.isOwner}
        email={me.email ?? ""}
        haeIngestUrl={ingestUrl("apple-health")}
      />
    </div>
  );
}
