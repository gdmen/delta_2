"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

interface Status {
  connected: boolean;
  athleteName?: string | null;
  athleteId?: number;
  lastSyncAt?: string | null;
}

interface SyncResult {
  fetched: number;
  accepted: number;
  skipped: number;
  unmappedTypes: Record<string, number>;
  errors: string[];
}

export default function StravaSetupPage() {
  // useSearchParams() needs a Suspense boundary for Next.js static export.
  return (
    <Suspense fallback={<div className="max-w-[820px] p-8 text-[0.875rem] text-muted">Loading...</div>}>
      <StravaSetupInner />
    </Suspense>
  );
}

function StravaSetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const callbackStatus = params.get("status");
  const callbackReason = params.get("reason");
  const callbackDetail = params.get("detail");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ingest/strava/sync");
      const json = await res.json();
      setStatus(json);
    } catch {
      setStatus({ connected: false });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handleSync(mode: "incremental" | "backfill") {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/ingest/strava/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSyncError(json.error ?? "Sync failed");
      } else {
        setSyncResult(json as SyncResult);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    }
    setSyncing(false);
    void loadStatus();
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Strava? Existing synced activities stay in Delta; you can reconnect later.")) return;
    await fetch("/api/ingest/strava/disconnect", { method: "POST" });
    setSyncResult(null);
    setSyncError(null);
    void loadStatus();
    // Clean any ?status= from the URL.
    router.replace("/data-sources/strava");
  }

  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Strava</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Connect Strava to import runs, rides, and hikes automatically. Dedup is by Strava activity ID, so you can sync
        the same history repeatedly without duplicates.
      </p>

      {/* OAuth callback banner */}
      {callbackStatus === "connected" && (
        <div className="mb-6 p-3 bg-accent-green/10 border border-accent-green/20 rounded text-[0.8125rem] text-accent-green">
          ✓ Connected. Run a sync to pull your activities.
        </div>
      )}
      {callbackStatus === "error" && (
        <div className="mb-6 p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          <div className="font-semibold mb-1">Connection failed: {callbackReason}</div>
          {callbackDetail && <div className="font-mono text-[0.75rem]">{callbackDetail}</div>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted py-4">
          <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          Checking status...
        </div>
      ) : !status?.connected ? (
        <Disconnected />
      ) : (
        <Connected
          status={status}
          syncing={syncing}
          syncResult={syncResult}
          syncError={syncError}
          onSync={handleSync}
          onDisconnect={handleDisconnect}
        />
      )}

      <PrereqNote />
    </div>
  );
}

function Disconnected() {
  return (
    <div>
      <div className="mb-6 p-4 border border-border rounded">
        <div className="text-[0.8125rem] text-text-secondary mb-3">
          Not connected. Click below to authorize Delta to read your activities.
        </div>
        <a
          href="/api/ingest/strava/connect"
          className="inline-block px-5 py-2 bg-[#fc4c02] text-white text-[0.875rem] font-semibold rounded hover:opacity-90"
        >
          Connect Strava
        </a>
      </div>
    </div>
  );
}

function Connected({
  status,
  syncing,
  syncResult,
  syncError,
  onSync,
  onDisconnect,
}: {
  status: Status;
  syncing: boolean;
  syncResult: SyncResult | null;
  syncError: string | null;
  onSync: (mode: "incremental" | "backfill") => void;
  onDisconnect: () => void;
}) {
  return (
    <div>
      <div className="mb-6 p-4 border border-border rounded">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="text-[0.8125rem] font-semibold text-accent-green">✓ Connected</div>
            {status.athleteName && (
              <div className="font-mono text-[0.75rem] text-muted mt-1">
                Athlete: {status.athleteName}
              </div>
            )}
          </div>
          <button
            onClick={onDisconnect}
            className="text-[0.75rem] text-muted hover:text-accent-red"
          >
            Disconnect
          </button>
        </div>
        <div className="font-mono text-[0.75rem] text-muted">
          Last sync:{" "}
          {status.lastSyncAt
            ? new Date(status.lastSyncAt).toLocaleString()
            : "never"}
        </div>
      </div>

      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => onSync("incremental")}
            disabled={syncing}
            className="px-5 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync recent (last 90 days)"}
          </button>
          <button
            onClick={() => onSync("backfill")}
            disabled={syncing}
            className="px-5 py-2 border border-border text-[0.875rem] font-medium rounded hover:bg-surface disabled:opacity-50"
          >
            Backfill all history
          </button>
        </div>
        <p className="text-[0.75rem] text-muted">
          Recent sync grabs everything from the last 90 days and is safe to run often. Backfill pulls every activity
          Strava has for you - use once, or when you&apos;ve been away a while. Both dedupe by activity ID.
        </p>
      </div>

      {syncing && (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted py-2">
          <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          Fetching activities... (this can take 30-60s on a full backfill)
        </div>
      )}

      {syncError && (
        <div className="mb-4 p-3 bg-accent-red/10 border border-accent-red/20 rounded">
          <div className="text-[0.8125rem] font-semibold text-accent-red mb-1">Sync failed</div>
          <div className="font-mono text-[0.75rem] text-accent-red">{syncError}</div>
        </div>
      )}

      {syncResult && (
        <div className="mb-4 p-3 bg-surface rounded">
          <div className="text-[0.8125rem] font-semibold mb-2">Sync result</div>
          <div className="font-mono text-[0.75rem] text-text-secondary space-y-0.5">
            <div>fetched:  {syncResult.fetched}</div>
            <div>accepted: {syncResult.accepted}</div>
            <div>skipped:  {syncResult.skipped}</div>
            {Object.keys(syncResult.unmappedTypes).length > 0 && (
              <div>
                unmapped types:{" "}
                {Object.entries(syncResult.unmappedTypes)
                  .map(([k, v]) => `${k} (${v})`)
                  .join(", ")}
              </div>
            )}
            {syncResult.errors.length > 0 && (
              <div className="text-accent-red pt-1">
                errors: {syncResult.errors.length}
                <ul className="mt-1 space-y-0.5">
                  {syncResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="break-words">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PrereqNote() {
  return (
    <details className="mt-10 border-t border-border pt-6">
      <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
        Prerequisites
      </summary>
      <div className="mt-4 text-[0.8125rem] text-text-secondary space-y-3 leading-[1.7]">
        <p>
          If you&apos;re getting a 503 or &quot;Strava not configured&quot; error, you need to register a Strava
          application first. One-time setup:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>
            Visit{" "}
            <a
              href="https://www.strava.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              strava.com/settings/api
            </a>{" "}
            and create an app.
          </li>
          <li>
            <strong>Authorization Callback Domain</strong>: the domain Delta is served from (e.g.{" "}
            <code className="font-mono bg-surface px-1 rounded">delta.garymenezes.com</code>, no path, no protocol).
          </li>
          <li>Copy the Client ID and Client Secret.</li>
          <li>
            On the server, add to <code className="font-mono bg-surface px-1 rounded">.env.local</code>:
            <pre className="mt-2 bg-surface p-2 rounded text-[0.75rem] font-mono overflow-x-auto">
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
            </pre>
          </li>
          <li>
            Restart: <code className="font-mono bg-surface px-1 rounded">sudo systemctl restart delta2</code>
          </li>
        </ol>
      </div>
    </details>
  );
}
