import { notFound } from "next/navigation";
import { loadShareTarget } from "@/lib/share/load";
import { runInShareScope } from "@/lib/share/scope";
import { DashboardRenderer } from "@/components/dashboards/DashboardRenderer";

/**
 * /share/[token] — read-only public dashboard view.
 *
 * The token IS the auth (the proxy exempts /share/* from the
 * session-cookie gate). We resolve the token to a (dashboard, owner)
 * pair, refuse if the row is missing OR revoked (404 either way —
 * never leak which it was), then render the dashboard inside a
 * runInShareScope so any code path that asks for getShareContext()
 * sees the OWNER's user_id, not the visitor's.
 *
 * Security properties (per the eng-review):
 *   - Owner of the dashboard mints the token; ONE active token per
 *     dashboard at a time (partial unique index in schema).
 *   - Render uses the owner's user_id explicitly via shareMode prop
 *     on DashboardRenderer. No edit affordances. No nav sidebar
 *     (root layout's auth check renders the bare layout for unauth
 *     visitors, which /share visitors are by definition).
 *   - CSP headers locked down — see next.config.ts (added in this
 *     phase). default-src 'self'; no inline scripts; frame-ancestors
 *     'self'. Mitigates owner-XSS-into-viewer via dashboard/widget
 *     titles.
 */
export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await loadShareTarget(token);
  if (!target) notFound();

  return runInShareScope(
    {
      ownerId: target.ownerId,
      ownerName: target.ownerName,
      token: target.token,
    },
    async () => (
      <div className="max-w-[1400px] mx-auto px-4 md:px-10 pt-8 pb-16">
        <header className="mb-6 pb-4 border-b border-border">
          <p className="text-[0.6875rem] uppercase tracking-wider text-muted">
            Shared by {target.ownerName} · read-only
          </p>
          <h1 className="text-2xl font-semibold mt-1">{target.dashboardName}</h1>
        </header>
        <DashboardRenderer
          slug={target.dashboardSlug}
          shareMode={{ ownerId: target.ownerId }}
        />
      </div>
    ),
  );
}
