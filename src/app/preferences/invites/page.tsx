import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteCodes, users } from "@/db/schema";
import { requireUserOrSignin } from "@/lib/auth/require";
import { siteOrigin } from "@/lib/site-url";
import { InvitesPanel } from "./panel";

/**
 * /preferences/invites — owner-only. Generate, list, revoke invite
 * codes. Non-owner users get bounced to /preferences (the route is
 * hidden from the sidebar for them anyway).
 */
export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const user = await requireUserOrSignin();
  if (!user.isOwner) redirect("/preferences");

  // Server-render the initial list so the page is useful on first paint.
  // Subsequent mutations refresh via the panel's local fetch.
  const initial = await db
    .select({
      code: inviteCodes.code,
      createdAt: inviteCodes.createdAt,
      expiresAt: inviteCodes.expiresAt,
      usedAt: inviteCodes.usedAt,
      usedByUserId: inviteCodes.usedByUserId,
      usedByDisplayName: users.displayName,
    })
    .from(inviteCodes)
    .leftJoin(users, eq(users.id, inviteCodes.usedByUserId))
    .where(eq(inviteCodes.createdByUserId, user.id))
    .orderBy(desc(inviteCodes.createdAt));

  return (
    <div className="max-w-[720px]">
      <h1 className="text-2xl font-semibold mb-2">Invites</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Generate single-use codes to onboard new users. Send the link
        out-of-band (text, email) — anyone with the link can claim
        the code.
      </p>

      <InvitesPanel initial={initial} signupOrigin={siteOrigin()} />
    </div>
  );
}
