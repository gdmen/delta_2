# Convenience targets for the common dev / migrate / verify chores.
# All real work lives in package.json + drizzle-kit; this file just gives
# the workflows that have come up enough to deserve a shortcut.

.PHONY: dev build start lint typecheck test test-watch clean distclean migrate backup verify-migration-0011

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

lint:
	npm run lint

typecheck:
	npx tsc --noEmit

test:
	npm test

test-watch:
	npm run test:watch

# Wipe every regeneratable build/cache artifact this project produces.
# Mirrors the build/cache entries in .gitignore — anything checked in or
# user-owned (node_modules, *.db, .env*, backups) is left alone. Use after
# a Node arch change (Rosetta x64 → arm64), a dependency upgrade that left
# stale chunks behind, or any time the dev server gets weird.
clean:
	rm -rf .next out build coverage
	find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete
	find . -name ".DS_Store" -not -path "./node_modules/*" -delete
	rm -f next-env.d.ts .eslintcache
	rm -f npm-debug.log* yarn-debug.log* yarn-error.log* .pnpm-debug.log*

# clean + nuke node_modules. Forces a fresh `npm install` next time.
# Use when a native module is misbehaving (e.g. lightningcss arch
# mismatch) and `make clean` alone isn't enough.
distclean: clean
	rm -rf node_modules

# Apply pending Drizzle migrations against the local SQLite DB.
migrate:
	npx drizzle-kit migrate

# WAL-safe SQLite backup. Plain `cp delta2.db ...` only copies the main
# file and silently misses anything still in the -wal sidecar; this uses
# sqlite3's online backup API so the snapshot is consistent.
backup:
	sqlite3 delta2.db ".backup delta2.db.bak.$$(date +%Y%m%d-%H%M%S)"

# Verify migration 0011 (goals-as-omnibus) applied cleanly: tables present,
# no orphaned focuses, journal entries copied from focus_entries, dropped
# tables truly gone. Run after `make migrate` for 0011.
verify-migration-0011:
	@echo "--- table presence ---"
	@sqlite3 delta2.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('focuses','goal_journal_entries','coach_calls') ORDER BY name;"
	@echo "--- dropped tables (should be empty) ---"
	@sqlite3 delta2.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('coach_messages','focus_entries','focus_metric_links');"
	@echo "--- focus orphan check (must be 0) ---"
	@sqlite3 delta2.db "SELECT COUNT(*) FROM focuses WHERE goal_id IS NULL OR goal_id NOT IN (SELECT id FROM goals);"
	@echo "--- counts ---"
	@sqlite3 delta2.db "SELECT 'focuses' AS t, COUNT(*) FROM focuses UNION ALL SELECT 'goal_journal_entries', COUNT(*) FROM goal_journal_entries UNION ALL SELECT 'coach_calls', COUNT(*) FROM coach_calls UNION ALL SELECT 'goals', COUNT(*) FROM goals;"
	@echo "--- focus source distribution ---"
	@sqlite3 delta2.db "SELECT source, COUNT(*) FROM focuses GROUP BY source;"
