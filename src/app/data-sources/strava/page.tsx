import Link from "next/link";
import { SourceDataBrowser } from "@/components/source-data-browser";
import { SourceSyncBehavior } from "@/components/source-sync-behavior";
import StravaSetupClient from "./setup-client";

export const dynamic = "force-dynamic";

export default function StravaPage() {
  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Strava</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        OAuth-based sync of runs, rides, and hikes. Dedupe by Strava activity ID.
      </p>

      <details className="mb-10 border-b border-border pb-6">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Setup & sync
        </summary>
        <div className="mt-6">
          <StravaSetupClient />
        </div>
      </details>

      <SourceSyncBehavior source="strava" />

      <section>
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source="strava" />
      </section>
    </div>
  );
}
