import type { Metadata } from "next";
import "./globals.css";
import { eq } from "drizzle-orm";
import { Sidebar } from "@/components/sidebar";
import { UndoToastHost } from "@/components/undo-toast";
import { loadAllDashboards } from "@/lib/dashboards/load";
import { auth } from "@/lib/auth/config";
import { db } from "@/db";
import { users } from "@/db/schema";

export const metadata: Metadata = {
  title: "Delta",
  description: "Fitness coaching dashboard",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Auth check at layout level so unauth pages (/signin, /signup,
  // /share/*) render without the sidebar. The proxy already exempts
  // those paths from the cookie gate, so users land here without a
  // session and we render a bare layout.
  const session = await auth();

  if (!session?.user?.id) {
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
