import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { eq } from "drizzle-orm";
import { Sidebar } from "@/components/sidebar";
import { UndoToastHost } from "@/components/undo-toast";
import { loadAllDashboards } from "@/lib/dashboards/load";
import { auth } from "@/lib/auth/config";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureScheduledDoses } from "@/lib/scheduled-doses";

export const metadata: Metadata = {
  title: "Delta",
  description: "Fitness coaching dashboard",
};

/**
 * Routes that should NEVER show the sidebar, even for signed-in
 * viewers. Auth pages match via the (auth) route group already; this
 * list catches public pages that share the root layout.
 *
 *   /share/<token> — read-only public dashboard view. Signed-in
 *     visitors must NOT see their own sidebar (which would leak their
 *     identity / dashboards into a screenshot of someone else's
 *     share link, and also hijacks the suspense streaming chain
 *     because the layout's auth + users SELECTs delay the shell).
 */
const BARE_LAYOUT_PREFIXES = ["/share/"] as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Pathname comes from the proxy's x-pathname header. App Router
  // server components can't read the URL directly. Falling back to "/"
  // means: in dev tools / tests where the proxy didn't set the header,
  // assume non-bare so the sidebar still renders.
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "/";
  const bare = BARE_LAYOUT_PREFIXES.some((p) => pathname.startsWith(p));

  // Auth check at layout level so unauth pages (/signin, /signup) and
  // bare-layout pages (/share/*) render without the sidebar. The proxy
  // already exempts those paths from the cookie gate.
  const session = bare ? null : await auth();

  if (bare || !session?.user?.id) {
    return (
      <html lang="en" className="h-full antialiased">
        <body className="min-h-full">{children}</body>
      </html>
    );
  }

  // Sidebar's "Dashboards" section is DB-driven so user-created dashboards
  // appear without code changes. The list is small (cap ~30) and the query
  // is indexed on (position) — re-fetching on every page load is fine and
  // keeps the sidebar in sync after mutations without explicit invalidation.
  const userId = parseInt(session.user.id, 10);
  const dashboards = Number.isFinite(userId) ? await loadAllDashboards(userId) : [];

  // User footer needs displayName + isOwner. Pull from the users
  // table since the JWT payload is locked to the minimum (per the
  // eng-review HIGH finding — no PII in cookies). One indexed
  // lookup per request; cheap.
  const userRows = Number.isFinite(userId)
    ? await db
        .select({
          displayName: users.displayName,
          isOwner: users.isOwner,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    : [];
  const sidebarUser = userRows[0] ?? { displayName: "User", isOwner: false };

  // Lazy-materialize today's scheduled doses (medications, etc.) for
  // this user. Cached per-process; after the first hit of the local
  // calendar day, this short-circuits to a Map lookup. Issue #30.
  // Best-effort: a failure here shouldn't block the page render, so
  // swallow + log instead of throwing.
  if (Number.isFinite(userId)) {
    try {
      await ensureScheduledDoses(userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("ensureScheduledDoses failed", err);
    }
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Sidebar dashboards={dashboards} user={sidebarUser} />
        <main className="md:ml-[200px] pt-16 md:pt-8 px-4 md:px-10 pb-8 max-w-[1400px]">
          {children}
        </main>
        <UndoToastHost />
      </body>
    </html>
  );
}
