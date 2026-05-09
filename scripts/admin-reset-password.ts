#!/usr/bin/env tsx
/**
 * Admin: reset a user's password from the server. The plan defers
 * email-link password reset (no SMTP infra in PR 2) — when a friend
 * forgets their password, the owner SSHes in, runs this script, and
 * hands them the new password out-of-band (text, in person, etc.).
 *
 * Bumps users.password_hash_version too — every outstanding JWT for
 * this user is invalidated on the next request so a stolen-and-cached
 * cookie can't be replayed.
 *
 * USAGE:
 *   DATABASE_URL=postgresql://... npx tsx scripts/admin-reset-password.ts
 *
 * Or non-interactive (for piping):
 *   echo -e "user@example.com\nnewpassword123\nnewpassword123" \
 *     | DATABASE_URL=... npx tsx scripts/admin-reset-password.ts
 */
import { eq, sql } from "drizzle-orm";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

function prompt(question: string, hidden = false): Promise<string> {
  if (!hidden) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    return new Promise((resolve) =>
      rl.question(question, (a) => {
        rl.close();
        resolve(a.trim());
      }),
    );
  }
  return new Promise((resolve) => {
    stdout.write(question);
    const original = stdin.isTTY ? (stdin as NodeJS.ReadStream).isRaw : false;
    if (stdin.isTTY) (stdin as NodeJS.ReadStream).setRawMode(true);
    let buf = "";
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString("utf-8");
      if (ch === "\r" || ch === "\n") {
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
  console.log("=== Delta password reset ===\n");
  const email = (await prompt("User email: ")).toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Email required.");
    process.exit(1);
  }

  // Verify the user exists before asking for a new password — saves
  // the operator from typing a fresh password when the email is wrong.
  const found = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (found.length === 0) {
    console.error(`No user with email "${email}".`);
    process.exit(1);
  }
  const target = found[0];
  console.log(`Target: ${target.displayName} (id=${target.id})`);

  const password = await prompt("New password (8+ chars): ", true);
  if (password.length < 8 || password.length > 256) {
    console.error("Password must be 8-256 characters.");
    process.exit(1);
  }
  const password2 = await prompt("Confirm: ", true);
  if (password !== password2) {
    console.error("Passwords don't match.");
    process.exit(1);
  }

  console.log("\nHashing password (argon2id)...");
  const hash = await hashPassword(password);

  await db
    .update(users)
    .set({
      passwordHash: hash,
      // Bump the version so any outstanding JWT for this user is
      // rejected on the next request (kill-all-sessions semantic).
      passwordHashVersion: sql`${users.passwordHashVersion} + 1`,
    })
    .where(eq(users.id, target.id));

  console.log(
    `\n✅ Password reset for ${target.displayName}. All existing sessions invalidated.`,
  );
  console.log(`Hand the new password to them out-of-band.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[reset-password] FAILED:", err);
  process.exit(1);
});
