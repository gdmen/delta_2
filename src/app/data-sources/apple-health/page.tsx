import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { SourceDataBrowser } from "@/components/source-data-browser";

export const dynamic = "force-dynamic";

const endpoint = "https://delta.garymenezes.com/api/ingest/apple-health";
const metricsList =
  "Step Count, Heart Rate, Resting Heart Rate, Heart Rate Variability, Active Energy, Weight & Body Mass, Body Fat Percentage, Lean Body Mass, VO2 Max, Protein, Dietary Water, Sleep Analysis";

export default function AppleHealthPage() {
  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Apple Health</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Automatic daily export via the Health Auto Export iOS app. Sleep, heart rate, HRV, active energy,
        steps, body metrics, dietary protein/water, and workouts.
      </p>

      <section className="mb-10">
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source="apple_health" />
      </section>

      <details className="border-t border-border pt-6">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Setup instructions
        </summary>
        <div className="mt-6">
          <Setup />
        </div>
      </details>
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
            Open the app → <strong>Automations</strong>{" "}tab → <strong>+</strong>{" "}→ pick{" "}
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
              <div className="text-muted text-[0.6875rem]">Method</div>
              <div>POST</div>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-muted text-[0.6875rem]">Headers (add one)</div>
                <div>
                  Key: <code>Authorization</code>
                  <br />
                  Value: <code>Bearer &lt;INGEST_API_KEY&gt;</code>
                </div>
              </div>
              <CopyButton value="Authorization" />
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Data format</div>
              <div>JSON (Aggregated)</div>
            </div>
          </div>
          <p className="mt-3 text-[0.75rem] text-muted">
            Your <code className="font-mono bg-surface px-1 rounded">INGEST_API_KEY</code>{" "}is in{" "}
            <code className="font-mono bg-surface px-1 rounded">.env.local</code>{" "}on the server (the bootstrap
            script prints it once). Generate a new one with{" "}
            <code className="font-mono bg-surface px-1 rounded">openssl rand -hex 32</code>{" "}if needed.
          </p>
        </StepBlock>

        <StepBlock number={4} title="Pick the metrics to export">
          <p className="mb-2">
            In the automation settings, enable these health metrics:
          </p>
          <div className="text-[0.8125rem] font-mono bg-surface rounded p-3 leading-snug">{metricsList}</div>
          <p className="mt-2 text-[0.75rem] text-muted">
            Also enable <strong>Workouts</strong>{" "}so runs, rides, BJJ, and strength sessions sync as events.
          </p>
        </StepBlock>

        <StepBlock number={5} title="Set the export schedule">
          <p className="mb-2">
            Choose <strong>Automatic Export → Daily</strong>{" "}(or hourly if you want near-realtime). The app runs in
            the background and retries on failure.
          </p>
          <p>
            Set <strong>Date Range</strong>{" "}to <strong>Since Last Sync</strong>{" "}so each run only ships new data
            since the previous export. Dedupe still catches accidental overlaps, but this keeps payloads small and
            fast.
          </p>
        </StepBlock>

        <StepBlock number={6} title="Backfill history (optional)">
          <p>
            Open the automation you just created and run a <strong>Manual Export</strong>{" "}covering your entire
            history. Re-exporting the same days is always safe - dedupe prevents duplicates.
          </p>
        </StepBlock>

        <StepBlock number={7} title="Verify">
          <p>
            After the first export fires, open the{" "}
            <Link href="/" className="text-foreground underline">Today dashboard</Link>{" "}- the key metrics strip
            should populate. The app&apos;s <strong>History</strong>{" "}tab shows each POST&apos;s HTTP status;{" "}
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
