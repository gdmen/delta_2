import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { SourceDataBrowser } from "@/components/source-data-browser";
import { SourceSyncBehavior } from "@/components/source-sync-behavior";
import { WipeSourceButton } from "@/components/wipe-source-button";

export const dynamic = "force-dynamic";

const endpoint = "https://delta.garymenezes.com/api/ingest/apple-health";
// HAE's exact display names for the 13 metrics we pull.
const metricsList =
  "Apple Stand Time, Headphone Audio Exposure, Heart Rate, Heart Rate Variability, Mindful Minutes, Protein, Respiratory Rate, Resting Heart Rate, Sleep Analysis, Step Count, VO2 Max, Water, Weight";

export default function AppleHealthPage() {
  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Apple Health</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Automatic daily export via the Health Auto Export iOS app. Sleep, heart rate, HRV, active energy,
        steps, body metrics, dietary protein/water, and workouts.
      </p>

      <details className="mb-10 border-b border-border pb-6">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Setup instructions
        </summary>
        <div className="mt-6">
          <Setup />
        </div>
      </details>

      <SourceSyncBehavior source="apple_health" />

      <section>
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source="apple_health" />
      </section>

      <WipeSourceButton source="apple_health" />
    </div>
  );
}

function Setup() {
  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-text-secondary">
        <a
          href="https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline"
        >
          Health Auto Export
        </a>{" "}
        is an iOS app that reads Apple Health and POSTs JSON to a URL on a schedule. It handles the background
        timer, retries, and data shaping - Delta just ingests what it sends. One-time setup, ~5 minutes.
      </p>

      <div className="space-y-5">
        <StepBlock number={1} title="Install Health Auto Export">
          <p>
            Install{" "}
            <a
              href="https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              Health Auto Export
            </a>{" "}
            from the App Store on your iPhone. On first launch, grant read access to all Health categories you want
            to sync (sleep, heart, activity, body measurements, nutrition, workouts).
          </p>
        </StepBlock>

        <StepBlock number={2} title="Create a REST API automation">
          <p>
            Open <strong>Health Auto Export</strong>{" "}→ <strong>Automations</strong>{" "}tab → <strong>+</strong>{" "}→ pick{" "}
            <strong>REST API</strong>{" "}as the export type.
          </p>
        </StepBlock>

        <StepBlock number={3} title="Configure the endpoint">
          <div className="text-[0.8125rem] font-mono bg-surface rounded p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-muted text-[0.6875rem]">URL</div>
                <div className="break-all">{endpoint}</div>
              </div>
              <CopyButton value={endpoint} />
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Timeout Interval</div>
              <div>60</div>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-muted text-[0.6875rem]">Authorization header</div>
                <div>
                  Key: <code>Authorization</code>
                  <br />
                  Value: <code>Bearer &lt;INGEST_API_KEY&gt;</code>
                </div>
              </div>
              <CopyButton value="Authorization" />
            </div>
          </div>
          <p className="mt-3 text-[0.75rem] text-muted">
            Your <code className="font-mono bg-surface px-1 rounded">INGEST_API_KEY</code>{" "}is in{" "}
            <code className="font-mono bg-surface px-1 rounded">.env.local</code>{" "}on the server (the bootstrap
            script prints it once). Generate a new one with{" "}
            <code className="font-mono bg-surface px-1 rounded">openssl rand -hex 32</code>{" "}if needed.
          </p>
        </StepBlock>

        <StepBlock number={4} title="Data type + export settings">
          <div className="text-[0.8125rem] font-mono bg-surface rounded p-3 space-y-2">
            <div>
              <div className="text-muted text-[0.6875rem]">Data Type</div>
              <div>Health Metrics</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Export Format</div>
              <div>JSON</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Export Version</div>
              <div>v2</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Date Range</div>
              <div>Today</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Summarize Data</div>
              <div>On</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Time Grouping</div>
              <div>Day</div>
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Batch Requests</div>
              <div>On</div>
            </div>
          </div>
        </StepBlock>

        <StepBlock number={5} title="Pick the metrics to export">
          <p className="mb-2">
            Under <strong>Select Health Metrics</strong>, enable these 13 (these are{" "}
            <strong>Health Auto Export</strong>&apos;s exact labels):
          </p>
          <div className="text-[0.8125rem] font-mono bg-surface rounded p-3 leading-snug">{metricsList}</div>
        </StepBlock>

        <StepBlock number={6} title="Set the sync cadence">
          <p>
            Under <strong>Sync Cadence</strong>, set <strong>Quantity</strong>{" "}to{" "}
            <code className="font-mono bg-surface px-1 rounded">15</code>{" "}and <strong>Interval</strong>{" "}
            to <strong>Minutes</strong>. With <strong>Date Range: Today</strong>{" "}(step 4), each run
            re-ships today&apos;s data; dedupe on the server keeps the DB clean.
          </p>
        </StepBlock>

        <StepBlock number={7} title="Backfill history (optional)">
          <p>
            Open the automation and run a <strong>Manual Export</strong>{" "}covering your entire history (change{" "}
            <strong>Date Range</strong>{" "}temporarily, run once, then set it back to <strong>Today</strong>).
            Re-exporting the same days is always safe - dedupe prevents duplicates.
          </p>
        </StepBlock>

        <StepBlock number={8} title="Verify">
          <p>
            After the first export fires, open the{" "}
            <Link href="/" className="text-foreground underline">Today dashboard</Link>{" "}- the key metrics strip
            should populate. In the <strong>Health Auto Export</strong>{" "}app, the <strong>History</strong>{" "}tab shows each POST&apos;s HTTP status;{" "}
            <code className="font-mono bg-surface px-1 rounded">200</code>{" "}means success.
          </p>
        </StepBlock>
      </div>
    </div>
  );
}

function StepBlock({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface flex items-center justify-center font-mono text-[0.75rem] font-semibold text-text-secondary">
        {number}
      </div>
      <div className="flex-1 pt-0.5">
        <h3 className="text-[0.875rem] font-semibold mb-1.5">{title}</h3>
        <div className="text-[0.8125rem] leading-[1.6] text-text-secondary space-y-2">{children}</div>
      </div>
    </div>
  );
}
