import Link from "next/link";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

export default function DataSourcesPage() {
  return (
    <div className="max-w-[820px]">
      <h1 className="text-2xl font-semibold mb-2">Data Sources</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Every way data flows into Delta: integrations, file uploads, and manual entry.
      </p>

      <IntegrationSection
        status="ready"
        title="Apple Health"
        description="Daily sync of sleep, heart rate, HRV, active energy, steps, body metrics, dietary protein/water, and workouts via an iOS Shortcut."
      >
        <AppleHealthSetup />
      </IntegrationSection>

      <IntegrationSection
        status="ready"
        title="BodySpec DEXA"
        description="Upload BodySpec DEXA scan PDFs. Claude extracts body fat %, lean mass, fat mass, bone mineral density, and visceral fat. Review before saving."
      >
        <p className="text-[0.875rem] text-text-secondary">
          <Link href="/data-sources/bodyspec" className="text-foreground underline">Upload a DEXA scan PDF →</Link>
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="ready"
        title="Strava"
        description="OAuth-based sync of runs, rides, and hikes. Dedup by Strava activity ID."
      >
        <p className="text-[0.875rem] text-text-secondary">
          <Link href="/data-sources/strava" className="text-foreground underline">Connect Strava →</Link>
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="coming-soon"
        title="TeamBuildr"
        description="CSV import of your programmed lifts (sets, reps, weight, RPE per exercise)."
      >
        <p className="text-[0.875rem] text-text-secondary">
          Coming soon. Export your training history from TeamBuildr as CSV, upload here, and it populates the{" "}
          <code className="font-mono text-[0.8125rem] bg-surface px-1 py-0.5 rounded">workout_sets</code>{" "}
          table.
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="manual-only"
        title="Goals"
        description="Target values with deadlines. The coach computes required rate vs actual rate and calls out gaps."
      >
        <p className="text-[0.875rem] text-text-secondary">
          Manual. Set a target (e.g. deadlift 500lb by April 2027) and the home dashboard tracks your required rate.{" "}
          <Link href="/input/goal" className="text-foreground underline">Add a goal →</Link>
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="manual-only"
        title="BJJ Sessions"
        description="Log mat time by type (class / open mat / drilling / teaching) with notes."
      >
        <p className="text-[0.875rem] text-text-secondary">
          Manual-only. No external app captures BJJ session categorization.{" "}
          <Link href="/input/bjj" className="text-foreground underline">Log a session →</Link>
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="manual-only"
        title="Focuses"
        description="Training focuses with narrative case files. This is the core differentiator — the coach reads focuses and correlates them with your metrics."
      >
        <p className="text-[0.875rem] text-text-secondary">
          Manual. Create focuses with technical notes, add narrative entries as you train, close with a verdict.{" "}
          <Link href="/input/focus" className="text-foreground underline">Manage focuses →</Link>
        </p>
      </IntegrationSection>

      <IntegrationSection
        status="coming-soon"
        title="Whoop / Garmin (stretch)"
        description="Proprietary metrics (Whoop Recovery, Strain; Garmin Body Battery, Training Load) not available via Apple Health."
      >
        <p className="text-[0.875rem] text-text-secondary">
          Stretch goal, post-month-1. Requires Whoop developer API approval or Garmin Connect OAuth.
          For now, Apple Health captures sleep, HRV, and resting HR which those wearables contribute.
        </p>
      </IntegrationSection>
    </div>
  );
}

function IntegrationSection({
  status,
  title,
  description,
  children,
}: {
  status: "ready" | "coming-soon" | "manual-only";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const statusLabel = {
    ready: { text: "READY", color: "text-accent-green" },
    "coming-soon": { text: "COMING SOON", color: "text-muted" },
    "manual-only": { text: "MANUAL", color: "text-sport-pl" },
  }[status];

  return (
    <section className="mb-8 pb-8 border-b border-border last:border-b-0">
      <div className="flex justify-between items-baseline mb-2">
        <h2 className="text-[1rem] font-semibold">{title}</h2>
        <span className={`font-mono text-[0.625rem] font-semibold uppercase tracking-wider ${statusLabel.color}`}>
          {statusLabel.text}
        </span>
      </div>
      <p className="text-[0.8125rem] text-text-secondary mb-4">{description}</p>
      {children}
    </section>
  );
}

function AppleHealthSetup() {
  const endpointPath = "/api/ingest/apple-health";
  const payloadTemplate = `{
  "samples": [
    {
      "type": "sleep_analysis_total",
      "value": 7.2,
      "unit": "h",
      "startDate": "2026-04-16T23:00:00Z",
      "uuid": "<Sample UUID>"
    }
  ],
  "workouts": [
    {
      "type": "martial_arts",
      "startDate": "2026-04-16T18:00:00Z",
      "endDate": "2026-04-16T19:30:00Z",
      "durationMinutes": 90,
      "uuid": "<Workout UUID>"
    }
  ]
}`;

  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-text-secondary">
        Build an iOS Shortcut that queries Health data and POSTs JSON to Delta. Runs daily in the background.
        One-time setup, ~15 minutes. You can copy-paste the template below into the Shortcut&apos;s Text action.
      </p>

      <div className="space-y-5">
        <StepBlock number={1} title="Create the Shortcut">
          <p>
            On your iPhone, open <strong>Shortcuts</strong>{" "}→ tap <strong>+</strong>{" "}→ name it &quot;Delta Daily Sync&quot;.
          </p>
        </StepBlock>

        <StepBlock number={2} title="Add Find Health Samples actions">
          <p className="mb-2">
            Add a <strong>Find Health Samples</strong>{" "}action for each type below. Set each to &quot;Start Date: is in the last 1 day&quot;.
          </p>
          <ul className="text-[0.8125rem] font-mono bg-surface rounded p-3 space-y-0.5 leading-snug">
            <li>Sleep Analysis</li>
            <li>Heart Rate Variability (SDNN)</li>
            <li>Resting Heart Rate</li>
            <li>Active Energy</li>
            <li>Step Count</li>
            <li>Body Mass</li>
            <li>Body Fat Percentage</li>
            <li>VO2 Max</li>
            <li>Dietary Protein</li>
            <li>Dietary Water</li>
          </ul>
          <p className="mt-2 text-[0.75rem] text-muted">
            Tip: after adding, tap the <strong>Find Health Samples</strong>{" "}result to rename each as &quot;Sleep&quot;, &quot;HRV&quot;, etc. — makes the next step easier.
          </p>
        </StepBlock>

        <StepBlock number={3} title="Add Find Workouts (optional)">
          <p>
            Add a <strong>Find Workouts</strong>{" "}action with Start Date in the last 1 day. Captures runs, rides, BJJ sessions, etc. logged via Apple Watch.
          </p>
        </StepBlock>

        <StepBlock number={4} title="Add a Text action with this template">
          <p className="mb-2">
            Add a <strong>Text</strong>{" "}action. Tap <strong>Copy</strong>, then paste into the Text action. Replace the literal values (7.2, &quot;&lt;Sample UUID&gt;&quot;, etc.) with magic variables from your Find Health Samples results.
          </p>
          <div className="relative">
            <pre className="text-[0.75rem] font-mono bg-surface rounded p-3 pr-20 overflow-x-auto">{payloadTemplate}</pre>
            <div className="absolute top-2 right-2">
              <CopyButton value={payloadTemplate} />
            </div>
          </div>
          <p className="mt-3 text-[0.75rem] text-muted">
            Repeat the object inside <code className="font-mono bg-surface px-1 rounded">samples[]</code>{" "}for each data type. Each needs a unique <code className="font-mono bg-surface px-1 rounded">type</code>{" "}key mapped to Delta&apos;s internal name (sleep_analysis_total, heart_rate_variability, resting_heart_rate, active_energy, step_count, body_mass, body_fat_percentage, vo2_max, dietary_protein, dietary_water).
          </p>
        </StepBlock>

        <StepBlock number={5} title="Add Get Contents of URL">
          <p className="mb-2">
            Add a <strong>Get Contents of URL</strong>{" "}action. Expand it and configure:
          </p>
          <div className="text-[0.8125rem] font-mono bg-surface rounded p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-muted text-[0.6875rem]">URL</div>
                <div className="break-all">https://delta.garymenezes.com{endpointPath}</div>
              </div>
              <CopyButton value={`https://delta.garymenezes.com${endpointPath}`} />
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Method</div>
              <div>POST</div>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-muted text-[0.6875rem]">Headers</div>
                <div>Authorization: Bearer &lt;INGEST_API_KEY&gt;</div>
              </div>
              <CopyButton value="Authorization" />
            </div>
            <div>
              <div className="text-muted text-[0.6875rem]">Request Body</div>
              <div>JSON → use the magic variable from the Text action in step 4</div>
            </div>
          </div>
          <p className="mt-3 text-[0.75rem] text-muted">
            Your <code className="font-mono bg-surface px-1 rounded">INGEST_API_KEY</code>{" "}is set on the server in <code className="font-mono bg-surface px-1 rounded">.env.local</code>. Generate one with{" "}
            <code className="font-mono bg-surface px-1 rounded">openssl rand -hex 32</code>{" "}and paste the same value into the Shortcut&apos;s header.
          </p>
        </StepBlock>

        <StepBlock number={6} title="Automate daily">
          <p>
            In the <strong>Automation</strong>{" "}tab → <strong>+</strong>{" "}→ <strong>Daily</strong>{" "}→ pick a time (6am or &quot;When I wake up&quot;) → select your &quot;Delta Daily Sync&quot; Shortcut → turn off <strong>Ask Before Running</strong>.
          </p>
        </StepBlock>

        <StepBlock number={7} title="Test and backfill">
          <p className="mb-2">
            Run the Shortcut manually once. A success response means data flowed in — open the{" "}
            <Link href="/" className="text-foreground underline">home dashboard</Link>{" "}and the key metrics strip should populate.
          </p>
          <p className="text-[0.8125rem] text-muted">
            To backfill history, duplicate the Shortcut, change &quot;last 1 day&quot; to &quot;last 365 days&quot;, run once, then delete the duplicate.
            The <code className="font-mono bg-surface px-1 rounded text-[0.75rem]">source_id</code>{" "}dedup prevents duplicates.
          </p>
        </StepBlock>

        <StepBlock number={8} title="Share your Shortcut (optional)">
          <p>
            Once it works, you can share the Shortcut as an iCloud link from the Shortcuts app (⋯ → Share → iCloud Link).
            Future you — or anyone else self-hosting Delta — can tap it to install and only needs to fill in their endpoint URL + API key.
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
