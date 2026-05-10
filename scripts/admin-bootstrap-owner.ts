#!/usr/bin/env tsx
/**
 * One-shot bootstrap script. Replaces the placeholder owner row
 * (users id=1, password_hash='!') with a real account.
 *
 * Run AFTER the migration applies. Prompts for:
 *   - email
 *   - display name
 *   - password (twice; min 8 chars; not echoed)
 *   - (optional) bring over INGEST_API_KEY from env to a per-user HAE
 *     key row in ingest_configs
 *
 * Idempotent: if the owner already has a real password (hash !== '!'),
 * the script aborts unless `--force` is set. With --force, the
 * password gets reset to the new value.
 *
 * USAGE:
 *   DATABASE_URL=postgresql://... \
 *   OAUTH_ENCRYPTION_KEY=$(openssl rand -hex 32) \
 *   npx tsx scripts/admin-bootstrap-owner.ts
 */
import { eq } from "drizzle-orm";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { generateAndSaveHaeKey } from "../src/lib/auth/api-key";
import { generateBearerToken } from "../src/lib/auth/secrets";

function prompt(question: string, hidden = false): Promise<string> {
  if (!hidden) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
  }
  // Hidden read for passwords — toggles ttyRawMode + manual echo
  // suppression. node:readline doesn't have a native "no echo" mode.
  return new Promise((resolve) => {
    stdout.write(question);
    const original = stdin.isTTY ? (stdin as NodeJS.ReadStream).isRaw : false;
    if (stdin.isTTY) (stdin as NodeJS.ReadStream).setRawMode(true);
    let buf = "";
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString("utf-8");
      if (ch === "\r" || ch === "\n" || ch === "") {
        if (stdin.isTTY) (stdin as NodeJS.ReadStream).setRawMode(original);
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(buf.trim());
      } else if (ch === "") {
        process.exit(130);
      } else if (ch === "" || ch === "\b") {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function main() {
  const force = process.argv.includes("--force");

  // Owner row should exist from the migration. Verify.
  const ownerRows = await db
    .select({ id: users.id, passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, 1))
    .limit(1);
  if (ownerRows.length === 0) {
    console.error(
      "[bootstrap] No row at users.id=1. The migration didn't seed the owner placeholder. Run `npx drizzle-kit migrate` first.",
    );
    process.exit(1);
  }
  const owner = ownerRows[0];

  if (owner.passwordHash && owner.passwordHash !== "!" && !force) {
    console.error(
      "[bootstrap] Owner is already bootstrapped (password_hash != '!'). Use --force to reset.",
    );
    process.exit(1);
  }

  console.log("=== Delta owner bootstrap ===\n");
  const email = await prompt("Email: ");
  if (!email || !email.includes("@")) {
    console.error("Email required (must contain @).");
    process.exit(1);
  }
  const displayName = await prompt("Display name: ");
  if (!displayName) {
    console.error("Display name required.");
    process.exit(1);
  }
  const password = await prompt("Password (8+ chars): ", true);
  if (password.length < 8 || password.length > 256) {
    console.error("Password must be 8-256 characters.");
    process.exit(1);
  }
  const password2 = await prompt("Confirm password: ", true);
  if (password !== password2) {
    console.error("Passwords don't match.");
    process.exit(1);
  }

  console.log("\nHashing password (argon2id)...");
  const passwordHash = await hashPassword(password);

  await db
    .update(users)
    .set({
      email: email.toLowerCase(),
      displayName,
      passwordHash,
      isOwner: true,
    })
    .where(eq(users.id, 1));

  console.log(`✅ Owner row at id=1 updated: ${email} / ${displayName}`);

  // If INGEST_API_KEY is set in the environment, migrate it into a
  // per-user HAE key row so the existing iOS Shortcut keeps working
  // without a re-setup.
  const legacyKey = process.env.INGEST_API_KEY;
  if (legacyKey) {
    console.log("\nMigrating INGEST_API_KEY env var into ingest_configs...");
    await generateAndSaveHaeKey(1, legacyKey);
    console.log(`✅ HAE key migrated. iOS Shortcut continues to work.`);
  } else {
    const generate = await prompt(
      "\nGenerate a fresh HAE bearer token now? (y/N): ",
    );
    if (generate.toLowerCase() === "y") {
      const fresh = generateBearerToken();
      await generateAndSaveHaeKey(1, fresh);
      console.log("\n✅ HAE bearer token generated. Copy this into your iOS Shortcut:");
      console.log(`\n    Bearer ${fresh}\n`);
      console.log("(Stored encrypted in ingest_configs.encrypted_value;");
      console.log(" you can regenerate from /preferences/account.)");
    }
  }

  console.log("\n=== Done. Owner can now sign in at /signin. ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[bootstrap] FAILED:", err);
  process.exit(1);
});
