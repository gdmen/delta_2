import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dashboardShareTokens, dashboards, users } from "@/db/schema";

/**
 * Resolve a /share/[token] URL parameter to the dashboard + owner it
 * grants read-only access to. Returns null on any of:
 *
 *   - token row missing
 *   - revoked_at IS NOT NULL
 *   - dashboard row gone (cascade-deleted via the share-token's FK,
 *     which would mean the row is gone too — but defense in depth)
 *
 * Callers turn null into a 404 — never leak which case it was, since
 * "row missing" vs "revoked" both mean "you can't see this."
 */
export interface ShareTarget {
  ownerId: number;
  ownerName: string;
  dashboardId: number;
  dashboardSlug: string;
  dashboardName: string;
  token: string;
}

export async function loadShareTarget(
  token: string,
): Promise<ShareTarget | null> {
  const rows = await db
    .select({
      token: dashboardShareTokens.token,
      revokedAt: dashboardShareTokens.revokedAt,
      dashboardId: dashboards.id,
      dashboardSlug: dashboards.slug,
      dashboardName: dashboards.name,
      ownerId: users.id,
      ownerName: users.displayName,
    })
    .from(dashboardShareTokens)
    .innerJoin(
      dashboards,
      eq(dashboards.id, dashboardShareTokens.dashboardId),
    )
    .innerJoin(users, eq(users.id, dashboards.userId))
    .where(
      and(
        eq(dashboardShareTokens.token, token),
        isNull(dashboardShareTokens.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    dashboardId: row.dashboardId,
    dashboardSlug: row.dashboardSlug,
    dashboardName: row.dashboardName,
    token: row.token,
  };
}
