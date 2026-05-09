import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { UndoToastHost } from "@/components/undo-toast";
import { loadAllDashboards } from "@/lib/dashboards/load";
import { auth } from "@/lib/auth/config";

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
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Sidebar dashboards={dashboards} />
        <main className="md:ml-[200px] pt-16 md:pt-8 px-4 md:px-10 pb-8 max-w-[1400px]">
          {children}
        </main>
        <UndoToastHost />
      </body>
    </html>
  );
}
