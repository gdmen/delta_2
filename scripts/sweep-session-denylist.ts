#!/usr/bin/env tsx
/**
 * Cron-runnable: delete session_denylist rows older than the JWT
 * TTL window (7d JWT TTL + 1d buffer = 8d). Past that, the JWT
 * those rows revoke is itself expired, so the row no longer
 * protects anything.
 *
 * USAGE (from a daily cron):
 *   DATABASE_URL=postgresql://... npx tsx scripts/sweep-session-denylist.ts
 *
 * Exits 0 on success (printing the row count); 1 on DB error so
 * cron's failure email triggers.
 */
import { sweep } from "../src/lib/auth/denylist";

async function main() {
  const deleted = await sweep();
  const ts = new Date().toISOString();
  console.log(`[${ts}] [sweep-session-denylist] deleted ${deleted} rows`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[sweep-session-denylist] FAILED:", err);
  process.exit(1);
});
