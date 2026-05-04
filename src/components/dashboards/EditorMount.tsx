"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Client-side mount point for the editor. Has to be a Client Component
 * because `next/dynamic` with `ssr: false` is only allowed inside Client
 * Components in Next.js 16. The Server Component (DashboardRenderer)
 * imports this and passes the server-fetched widgets / picker context
 * through.
 *
 * Splitting it out instead of marking DashboardRenderer "use client"
 * preserves the renderer's RSC-on-view-mode behavior for the (much more
 * common) non-edit path.
 */
const DashboardEditor = dynamic(
  () => import("./editor/DashboardEditor").then((m) => m.DashboardEditor),
  { ssr: false },
);

type Props = ComponentProps<typeof DashboardEditor>;

export function EditorMount(props: Props) {
  return <DashboardEditor {...props} />;
}
