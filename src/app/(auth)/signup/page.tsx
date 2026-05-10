import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, inviteCodes } from "@/db/schema";
import { SignUpForm } from "./form";

/**
 * /signup?code=<invite>
 *
 * Per the design plan, four query-state cases are distinguishable
 * here and each gets different copy:
 *
 *   1. No code present                  → "An invite link is required."
 *   2. Code valid + unused              → render form (happy path)
 *   3. Code already used                → "This invite has already been claimed."
 *   4. Code expired or malformed        → "This invite link is invalid or expired."
 *
 * Plus the cross-cutting case: if the user is already signed in, just
 * redirect to /. The invite code stays untouched so they can hand it
 * to whoever it was meant for.
 *
 * Owner display name is rendered into the header ("Delta is
 * <owner>'s fitness tracker — you've been invited.") so the invitee
 * has context. Falls back to a generic copy if the owner row's
 * display name is empty.
 */
export const dynamic = "force-dynamic";

interface SignupPageState {
  status: "ok" | "missing-code" | "used" | "expired-or-malformed";
  ownerName: string;
}

async function evaluateSignup(code: string | undefined): Promise<SignupPageState> {
  const ownerRow = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.isOwner, true))
    .limit(1);
  const ownerName = ownerRow[0]?.displayName?.trim() || "Delta";

  if (!code) return { status: "missing-code", ownerName };

  const found = await db
    .select({
      code: inviteCodes.code,
      usedAt: inviteCodes.usedAt,
      expiresAt: inviteCodes.expiresAt,
    })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);
  const row = found[0];
  if (!row) return { status: "expired-or-malformed", ownerName };
  if (row.usedAt) return { status: "used", ownerName };
  if (row.expiresAt && row.expiresAt < new Date().toISOString()) {
    return { status: "expired-or-malformed", ownerName };
  }
  return { status: "ok", ownerName };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const session = await auth();
  if (session?.user?.id) {
    redirect("/");
  }

  const state = await evaluateSignup(code);

  if (state.status !== "ok") {
    return (
      <div className="space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold">{titleFor(state.status)}</h1>
        </header>
        <p className="text-[0.875rem] text-muted text-center">
          {bodyFor(state.status, state.ownerName)}
        </p>
      </div>
    );
  }

  return <SignUpForm code={code!} ownerName={state.ownerName} />;
}

function titleFor(s: SignupPageState["status"]): string {
  switch (s) {
    case "missing-code":
      return "Invite link required";
    case "used":
      return "Invite already claimed";
    case "expired-or-malformed":
      return "Invite invalid or expired";
    default:
      return "Sign up";
  }
}

function bodyFor(s: SignupPageState["status"], owner: string): string {
  switch (s) {
    case "missing-code":
      return `Ask ${owner} for an invite link.`;
    case "used":
      return `Someone already signed up with this code. If it was you, sign in instead. Otherwise ask ${owner} for a new code.`;
    case "expired-or-malformed":
      return `This invite link doesn't work. Ask ${owner} for a fresh one.`;
    default:
      return "";
  }
}
